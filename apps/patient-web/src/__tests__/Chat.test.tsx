import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createApiClient, HidApiError } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import type { PatientChatAvailability, PatientChatHistory, PatientChatReply } from '@hid/contracts'
import { PatientChat, ChatConversation, type ChatConversationApi } from '../routes/Chat'
import { SessionContext, createTestSessionValue } from '../session'
import { createPatientApi } from '../api'

/**
 * The patient's record chat against hid-system main (#95, ADR-068; docs/INTERFACE_CONTRACT.md, "Patient record
 * chat"): availability and the notice, a question with its notice version and Idempotency-Key, blocks and
 * references, the saved history (newest first) and its deletion. The staging branches' screen is
 * StagingChat.test.tsx.
 */
const patient = { kind: 'patient', subjectId: 'patient-a', appRole: 'patient', assuranceLevel: 'aal1' } as const
const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`
const NOTICE = 'ADR-068@2026-10-16'
const on: PatientChatAvailability = { available: true, noticeVersion: NOTICE, historyLimit: 50, maxQuestionLength: 1000, released: ['encounters', 'notes'] }
const source = { number: 1, kind: 'note' as const, id: id(1), recordedOn: '2026-10-01', effectiveOn: null, title: '<b>Plain title</b>' }
const answer = (over: Partial<PatientChatReply> = {}): PatientChatReply => ({
  status: 'answered', answer: 'A released note says example.', conversationId: id(2), messageId: id(3), createdAt: '2026-10-17T10:00:00.000Z',
  idempotentReplay: false, sources: [source], blocks: [{ kind: 'record', text: 'A released note says example.', references: [1] }],
  coverage: { complete: true, released: ['encounters', 'notes'], withheld: [], truncated: false, selectedCount: 1, recordCount: 1 }, ...over,
})
const none: PatientChatHistory = { conversationId: null, exchanges: [], limit: 50 }
const exchange = (n: number, question: string, text: string) => ({ messageId: id(n), question, createdAt: '2026-10-17T10:00:00.000Z',
  reply: { status: 'answered' as const, answer: text, blocks: [{ kind: 'explanation' as const, text, references: [] }], sources: [] } })

function apiFor(over: Partial<Record<keyof ChatConversationApi, unknown>> = {}) {
  return {
    chatAvailability: vi.fn().mockResolvedValue(on), chat: vi.fn().mockResolvedValue(answer()),
    chatHistory: vi.fn().mockResolvedValue(none), clearChatHistory: vi.fn().mockResolvedValue({ cleared: true, deletedCount: 0 }), ...over,
  } as unknown as ChatConversationApi & Record<'chatAvailability' | 'chat' | 'chatHistory' | 'clearChatHistory', ReturnType<typeof vi.fn>>
}
const asked = () => screen.getByLabelText('Your question') as HTMLTextAreaElement
const send = () => screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement
/** Waits for availability and history, then accepts the notice. */
async function ready(accept = true) {
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  await screen.findByRole('heading', { name: 'Before you ask' })
  if (accept) fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }))
}
const ask = (text: string) => { fireEvent.change(asked(), { target: { value: text } }); fireEvent.click(send()) }
beforeEach(() => { vi.restoreAllMocks() })

it('sends a question with the notice version and an Idempotency-Key through the registered cookie client', async () => {
  const fetchImpl = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const path = String(url)
    const body = path.endsWith('/availability') ? on : path.endsWith('/history') ? none : answer()
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const transport = createApiClient({ baseUrl: 'https://staging.healthidentitydirectory.com', clientId: 'patient-web',
    sessionMode: 'cookie', getCsrfToken: () => 'synthetic-csrf-token', fetchImpl: fetchImpl as unknown as typeof fetch })
  const api = createPatientApi(createRegisteredBrowserClient(transport, 'patient-web'))
  render(<SessionContext.Provider value={createTestSessionValue(patient, api)}><PatientChat /></SessionContext.Provider>)
  await ready()
  ask('What are you?')
  expect(await screen.findAllByText('A released note says example.')).toBeTruthy()
  const calls = fetchImpl.mock.calls.map(([url, init]) => [String(url), init] as const)
  expect(calls.map(([url]) => new URL(url).pathname).sort()).toEqual(['/api/v1/ehr/me/chat', '/api/v1/ehr/me/chat/availability', '/api/v1/ehr/me/chat/history'])
  const post = calls.find(([url]) => new URL(url).pathname === '/api/v1/ehr/me/chat')![1]!
  expect(post).toMatchObject({ method: 'POST', credentials: 'include', body: JSON.stringify({ question: 'What are you?', noticeVersion: NOTICE }) })
  const headers = new Headers(post.headers)
  expect(headers.get('X-CSRF-Token')).toBe('synthetic-csrf-token')
  expect(headers.get('Idempotency-Key')).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
})

it('does not mount patient chat for an authenticated staff context', () => {
  const staff = { kind: 'staff', subjectId: 'staff-a', appRole: 'clinician', assuranceLevel: 'aal1', staffRole: 'doctor', organizationId: 'synthetic-organization' } as const
  const api = apiFor()
  render(<SessionContext.Provider value={createTestSessionValue(staff, api as never)}><PatientChat /></SessionContext.Provider>)
  expect(screen.queryByLabelText('Your question')).toBeNull()
  expect(api.chatAvailability).not.toHaveBeenCalled()
})

it('asks for the notice first: no question is sent until it is accepted', async () => {
  const api = apiFor()
  render(<ChatConversation api={api} />)
  await ready(false)
  expect(screen.getByText(/Anthropic/)).toBeTruthy()
  fireEvent.change(asked(), { target: { value: 'A question' } })
  expect(send().disabled).toBe(true)
  fireEvent.keyDown(asked(), { key: 'Enter' })
  expect(api.chat).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }))
  expect(send().disabled).toBe(false)
  fireEvent.click(send())
  await screen.findAllByText('A released note says example.')
  expect(api.chat).toHaveBeenCalledWith('A question', { noticeVersion: NOTICE, idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/), maxQuestionLength: 1000 },
    { signal: expect.any(AbortSignal) })
})

it('says record chat is not available yet, keeps the saved conversation readable and offers no composer', async () => {
  const api = apiFor({ chatAvailability: vi.fn().mockResolvedValue({ available: false }), chatHistory: vi.fn().mockResolvedValue({ conversationId: id(2), limit: 50, exchanges: [exchange(3, 'Old question', 'Old answer')] }) })
  render(<ChatConversation api={api} />)
  expect(await screen.findByText(/Record chat is not available yet/)).toBeTruthy()
  expect(await screen.findByText('Old question')).toBeTruthy()
  expect(screen.queryByLabelText('Your question')).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  await waitFor(() => expect(api.clearChatHistory).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.queryByText('Old question')).toBeNull())
})

it('retries a failed availability check', async () => {
  const api = apiFor({ chatAvailability: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(on) })
  render(<ChatConversation api={api} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('heading', { name: 'Before you ask' })).toBeTruthy()
})

it('shows the saved conversation oldest first, though the service lists newest first', async () => {
  const api = apiFor({ chatHistory: vi.fn().mockResolvedValue({ conversationId: id(2), limit: 50,
    exchanges: [exchange(4, 'Second question', 'Second answer'), exchange(3, 'First question', 'First answer')] }) })
  render(<ChatConversation api={api} />)
  await ready()
  const text = screen.getByRole('log').textContent ?? ''
  expect(text.indexOf('First question')).toBeLessThan(text.indexOf('Second question'))
  expect(text.indexOf('First answer')).toBeLessThan(text.indexOf('Second answer'))
})

it('renders blocks as text, with references that point at their sources, and no markup', async () => {
  const api = apiFor({ chat: vi.fn().mockResolvedValue(answer({ blocks: [
    { kind: 'record', text: 'Your note says <b>example</b>.', references: [1] },
    { kind: 'safety', text: 'If you feel worse, seek care.', references: [] }] })) })
  render(<ChatConversation api={api} />)
  await ready()
  ask('Question')
  expect(await screen.findByText('Your note says <b>example</b>.')).toBeTruthy()
  expect(screen.getByRole('log').querySelector('b')).toBeNull()
  expect(screen.getByText('Important')).toBeTruthy()
  const reference = screen.getByRole('link', { name: 'Record reference 1' })
  expect(reference.getAttribute('href')).toBe(`#chat-source-${id(3)}-1`)
  expect(document.getElementById(`chat-source-${id(3)}-1`)?.textContent).toContain('<b>Plain title</b>')
  expect(screen.getByText(/Clinical note · 1 Oct 2026/)).toBeTruthy()
})

it.each([
  ['no_evidence', 'Your released records do not hold information to answer this question yet.'],
  ['declined', 'This question could not be answered here. For questions about your health, please contact your care team.'],
  ['unverified', 'An answer could not be checked against your records, so it is not shown. Please try asking in another way, or contact your care team.'],
] as const)('shows the fixed %s text and cites nothing', async (status, text) => {
  const api = apiFor({ chat: vi.fn().mockResolvedValue(answer({ status, answer: text, sources: [], blocks: [{ kind: 'explanation', text, references: [] }] })) })
  render(<ChatConversation api={api} />)
  await ready()
  ask('Question')
  expect(await screen.findByText(text)).toBeTruthy()
  expect(screen.queryByText(/^\d+ record references?$/)).toBeNull()
})

it('says when an answer used only part of the records, and which record types were withheld', async () => {
  const api = apiFor({ chat: vi.fn().mockResolvedValue(answer({ coverage: { complete: false, released: ['notes'], withheld: ['lab results'], truncated: true, selectedCount: 40, recordCount: 90 } })) })
  render(<ChatConversation api={api} />)
  await ready()
  ask('Question')
  expect(await screen.findByText(/used 40 of 90 released records/)).toBeTruthy()
  expect(screen.getByText(/not released to you yet and were not read: lab results/)).toBeTruthy()
})

it('shows the sent question at once, keeps a new draft while a reply is pending, and prevents a second send', async () => {
  let resolve!: (value: PatientChatReply) => void
  const chat = vi.fn(() => new Promise<PatientChatReply>(done => { resolve = done }))
  render(<ChatConversation api={apiFor({ chat })} />)
  await ready()
  ask('My first question')
  fireEvent.click(send())
  expect(chat).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('log').textContent).toContain('My first question')
  expect(screen.getByRole('status').textContent).toContain('Reading your released records')
  expect(asked().value).toBe('')
  fireEvent.change(asked(), { target: { value: 'My next question' } })
  resolve(answer())
  expect((await screen.findAllByText('A released note says example.')).length).toBeGreaterThan(0)
  expect(asked().value).toBe('My next question')
})

it('cancels the question in flight on unmount', async () => {
  const chat = vi.fn((_q: string, _a: unknown, _o: { signal: AbortSignal }) => new Promise(() => {}))
  const view = render(<ChatConversation api={apiFor({ chat })} />)
  await ready()
  ask('Question')
  const signal = chat.mock.calls[0]?.[2].signal
  view.unmount()
  expect(signal?.aborted).toBe(true)
})

it('sends the same key when the same question is sent again after a failure, and a new key for another question', async () => {
  const chat = vi.fn().mockRejectedValueOnce(new HidApiError(503, 'Private', { code: 'RECORD_CHAT_UNAVAILABLE' })).mockResolvedValue(answer())
  render(<ChatConversation api={apiFor({ chat })} />)
  await ready()
  ask('The same question')
  expect((await screen.findByRole('alert')).textContent).toContain('unavailable')
  expect(asked().value).toBe('The same question')
  fireEvent.click(send())
  await screen.findAllByText('A released note says example.')
  const keys = chat.mock.calls.map(call => call[1].idempotencyKey)
  expect(keys[0]).toBe(keys[1])
  ask('Another question')
  await waitFor(() => expect(chat).toHaveBeenCalledTimes(3))
  expect(chat.mock.calls[2]?.[1].idempotencyKey).not.toBe(keys[0])
})

it('asks for the notice again when its version changed (428), keeping the draft', async () => {
  const availability = vi.fn().mockResolvedValueOnce(on).mockResolvedValue({ ...on, noticeVersion: 'ADR-068@2026-11-01' })
  const chat = vi.fn().mockRejectedValue(new HidApiError(428, 'Private', { code: 'CHAT_NOTICE_REQUIRED' }))
  render(<ChatConversation api={apiFor({ chatAvailability: availability, chat })} />)
  await ready()
  ask('Question')
  expect((await screen.findByRole('alert')).textContent).toContain('notice about how record chat works has changed')
  await waitFor(() => expect(availability).toHaveBeenCalledTimes(2))
  expect((screen.getByRole('checkbox', { name: /I understand/ }) as HTMLInputElement).checked).toBe(false)
  expect(asked().value).toBe('Question')
  expect(send().disabled).toBe(true)
})

it.each([
  [401, 'AUTHENTICATION_REQUIRED', 'Your session ended. Please sign in again.'],
  [403, 'PATIENT_ACCESS_DENIED', 'You do not have access to record chat.'],
  [503, 'RECORD_CHAT_DISABLED', 'Record chat is not available right now.'],
  [503, 'RECORD_CHAT_PAUSED', 'Record chat is not available right now.'],
  [503, 'RECORD_CHAT_BUDGET_EXHAUSTED', 'Record chat has reached its limit for today. Please try again tomorrow.'],
  [429, 'RECORD_CHAT_BUSY', 'Another question is being answered. Please try again in a few seconds.'],
  [429, 'RECORD_CHAT_RATE_LIMITED', 'You have asked as many questions as record chat allows for now (10 an hour, 30 a day). Please try again later.'],
  [409, 'CHAT_HISTORY_FULL', 'Your saved conversation is full (50 exchanges). Start a new conversation to ask more.'],
  [409, 'CHAT_SOURCES_CHANGED', 'A record this answer used has changed. Please ask your question again.'],
  [409, 'CHAT_CONVERSATION_CHANGED', 'This conversation was cleared while your question was being answered. Please ask again.'],
  [409, 'IDEMPOTENCY_KEY_REUSED', 'Your question could not be sent again. Please ask it again.'],
  [400, 'INVALID_QUESTION', 'Your question could not be sent. Please shorten it and remove unusual characters.'],
  [503, 'PATIENT_RECORDS_UNAVAILABLE', 'Your records could not be read right now. Please try again shortly.'],
  [0, 'REQUEST_TIMEOUT', 'The reply took too long. Please try again.'],
  [500, 'SOMETHING_ELSE', 'Record chat is unavailable. Please try again later.'],
])('shows a safe message for %s %s, without the provider detail', async (status, code, message) => {
  const chat = vi.fn().mockRejectedValue(new HidApiError(status, 'Private provider detail', { code }))
  render(<ChatConversation api={apiFor({ chat })} />)
  await ready()
  ask('Question')
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe(message)
  expect(screen.queryByText(/Private provider detail/)).toBeNull()
  expect(chat).toHaveBeenCalledTimes(1)
})

it('stops asking when the saved conversation is full and says so', async () => {
  const exchanges = Array.from({ length: 50 }, (_unused, index) => exchange(index + 3, `Question ${index}`, `Answer ${index}`))
  const api = apiFor({ chatHistory: vi.fn().mockResolvedValue({ conversationId: id(2), limit: 50, exchanges }) })
  render(<ChatConversation api={api} />)
  await ready()
  expect(screen.getByText(/Your saved conversation is full \(50 exchanges\)/)).toBeTruthy()
  fireEvent.change(asked(), { target: { value: 'One more' } })
  expect(send().disabled).toBe(true)
})

it('blocks sends while the history loads', async () => {
  let resolve!: (value: PatientChatHistory) => void
  const api = apiFor({ chatHistory: vi.fn(() => new Promise<PatientChatHistory>(done => { resolve = done })) })
  render(<ChatConversation api={api} />)
  await screen.findByRole('heading', { name: 'Before you ask' })
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }))
  fireEvent.change(asked(), { target: { value: 'Wait' } })
  fireEvent.keyDown(asked(), { key: 'Enter' })
  expect(api.chat).not.toHaveBeenCalled()
  resolve(none)
  await waitFor(() => expect(send().disabled).toBe(false))
})

it('keeps the history and says so when it could not be loaded, then retries', async () => {
  const api = apiFor({ chatHistory: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ conversationId: id(2), limit: 50, exchanges: [exchange(3, 'Saved question', 'Saved answer')] }) })
  render(<ChatConversation api={api} />)
  expect(await screen.findByText('Your saved conversation could not be loaded. Please try again.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading conversation' }))
  expect(await screen.findByText('Saved question')).toBeTruthy()
})

it('deletes the saved conversation, and keeps it visible with a clear message if a legal hold or a failure stops it', async () => {
  const saved = { conversationId: id(2), limit: 50, exchanges: [exchange(3, 'Saved question', 'Saved answer')] }
  const clear = vi.fn().mockRejectedValueOnce(new HidApiError(409, 'Private', { code: 'CHAT_HISTORY_ON_HOLD' })).mockResolvedValue({ cleared: true, deletedCount: 1 })
  render(<ChatConversation api={apiFor({ chatHistory: vi.fn().mockResolvedValue(saved), clearChatHistory: clear })} />)
  expect(await screen.findByText('Saved question')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  expect((await screen.findByRole('alert')).textContent).toContain('legal hold')
  expect(screen.getByText('Saved question')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  await waitFor(() => expect(screen.queryByText('Saved question')).toBeNull())
})

it('new conversation cancels old work and ignores a late reply', async () => {
  const pending: Array<(value: PatientChatReply) => void> = []
  const chat = vi.fn((_q: string, _a: unknown, _o: { signal: AbortSignal }) => new Promise<PatientChatReply>(done => pending.push(done)))
  render(<ChatConversation api={apiFor({ chat })} />)
  await ready()
  ask('Old question')
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  expect(chat.mock.calls[0]?.[2].signal.aborted).toBe(true)
  await waitFor(() => expect(screen.queryByText('Old question')).toBeNull())
  pending[0]?.(answer({ answer: 'Late old reply', blocks: [{ kind: 'explanation', text: 'Late old reply', references: [] }], sources: [] }))
  await new Promise(done => setTimeout(done, 20))
  expect(screen.queryByText('Late old reply')).toBeNull()
})

it('discards the conversation when the account changes or signs out, and writes nothing to browser storage', async () => {
  const api = apiFor({ chatHistory: vi.fn().mockResolvedValue({ conversationId: id(2), limit: 50, exchanges: [exchange(3, 'Previous question', 'Previous answer')] }) })
  const write = vi.spyOn(Storage.prototype, 'setItem')
  const view = render(<SessionContext.Provider value={createTestSessionValue(patient, api as never)}><PatientChat /></SessionContext.Provider>)
  expect(await screen.findByText('Previous question')).toBeTruthy()
  view.rerender(<SessionContext.Provider value={createTestSessionValue(null, api as never)}><PatientChat /></SessionContext.Provider>)
  expect(screen.queryByText('Previous question')).toBeNull()
  view.rerender(<SessionContext.Provider value={createTestSessionValue(patient, api as never)}><PatientChat /></SessionContext.Provider>)
  expect(await screen.findByText('Previous question')).toBeTruthy()
  expect(api.chatHistory).toHaveBeenCalledTimes(2)
  expect(write).not.toHaveBeenCalled()
})

it('suggestions prepare a question for explicit sending and focus the composer', async () => {
  const api = apiFor()
  render(<ChatConversation api={api} />)
  await ready()
  fireEvent.click(screen.getByRole('button', { name: /Summarise my history/ }))
  expect(asked().value).toBe('Summarise my medical history and important recent recorded events.')
  expect(document.activeElement).toBe(asked())
  expect(api.chat).not.toHaveBeenCalled()
})

it('Enter sends, Shift+Enter does not, and a question over the service limit does not send', async () => {
  const api = apiFor()
  render(<ChatConversation api={api} />)
  await ready()
  fireEvent.change(asked(), { target: { value: 'A question' } })
  fireEvent.keyDown(asked(), { key: 'Enter', shiftKey: true })
  expect(api.chat).not.toHaveBeenCalled()
  fireEvent.keyDown(asked(), { key: 'Enter' })
  await screen.findAllByText('A released note says example.')
  expect(api.chat).toHaveBeenCalledTimes(1)
  expect(asked().maxLength).toBe(1000)
})
