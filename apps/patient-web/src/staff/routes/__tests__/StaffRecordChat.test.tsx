import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import type { PatientChatAvailability, PatientChatHistory, PatientChatReply } from '@hid/contracts'
import { StaffRecordChat, type StaffRecordChatApi } from '../StaffRecordChat'

/**
 * Staff record chat against hid-system main (ADR-069, 0101; docs/INTERFACE_CONTRACT.md, "Staff record chat"):
 * availability and the notice, a question with its notice version and Idempotency-Key, blocks and references,
 * the member's own history (newest first), its deletion, and what a refusal of access says.
 */
const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`
const NOTICE = 'ADR-069@2026-10-17'
const on: PatientChatAvailability = { available: true, noticeVersion: NOTICE, historyLimit: 50, maxQuestionLength: 1000,
  released: ['encounters', 'notes', 'vitals'], withheld: ['diagnoses', 'labRequests', 'labResults'] }
const source = { number: 1, kind: 'vital' as const, id: id(1), recordedOn: '2026-10-01', effectiveOn: null, title: '<b>Vital signs</b>' }
const answer = (over: Partial<PatientChatReply> = {}): PatientChatReply => ({
  status: 'answered', answer: 'The last blood pressure was 118 over 76.', conversationId: id(2), messageId: id(3), createdAt: '2026-10-17T10:00:00.000Z',
  idempotentReplay: false, sources: [source], blocks: [{ kind: 'record', text: 'The last blood pressure was 118 over 76.', references: [1] }],
  coverage: { complete: true, released: ['encounters', 'notes', 'vitals'], withheld: ['labRequests', 'labResults'], truncated: false, selectedCount: 1, recordCount: 1 }, ...over,
})
const none: PatientChatHistory = { conversationId: null, exchanges: [], limit: 50 }
const exchange = (n: number, question: string, text: string) => ({ messageId: id(n), question, createdAt: '2026-10-17T10:00:00.000Z',
  reply: { status: 'answered' as const, answer: text, blocks: [{ kind: 'explanation' as const, text, references: [] }], sources: [] } })
const refusal = (status: number, code: string) => new HidApiError(status, 'Private provider detail', { code })

type Mocked = StaffRecordChatApi & Record<'availability' | 'ask' | 'history' | 'clear', ReturnType<typeof vi.fn>>
function apiFor(over: Partial<Record<keyof StaffRecordChatApi, unknown>> = {}): Mocked {
  return { availability: vi.fn().mockResolvedValue(on), ask: vi.fn().mockResolvedValue(answer()), history: vi.fn().mockResolvedValue(none),
    clear: vi.fn().mockResolvedValue({ cleared: true, deletedCount: 0 }), ...over } as unknown as Mocked
}
const props = { patientName: 'Synthetic Patient', hid: 'HID-AAAAAA', facilityName: 'Synthetic Hospital' }
const asked = () => screen.getByLabelText('Your question') as HTMLTextAreaElement
const send = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
async function ready(accept = true) {
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  await screen.findByRole('heading', { name: 'Before you ask' })
  if (accept) fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }))
}
const ask = (text: string) => { fireEvent.change(asked(), { target: { value: text } }); fireEvent.click(send()) }
beforeEach(() => { vi.restoreAllMocks() })

describe('StaffRecordChat', () => {
  it('names the patient and facility, offers what this member may read and what is withheld, and shows the notice', async () => {
    render(<StaffRecordChat api={apiFor()} {...props} />)
    await ready(false)
    expect(screen.getByRole('heading', { name: 'Ask about Synthetic Patient' })).toBeTruthy()
    expect(screen.getByText(/HID-AAAAAA · Synthetic Hospital · direct care only/)).toBeTruthy()
    fireEvent.click(screen.getByText('Which records can I ask about?'))
    expect(screen.getByText(/Record chat can read: encounters, notes, vitals\./)).toBeTruthy()
    expect(screen.getByText(/Not read: diagnoses, labRequests, labResults\./)).toBeTruthy()
    expect(screen.getByText(/Lab results and requests, other facilities’ records, imported history and the content of documents are not sent/)).toBeTruthy()
    expect(send().disabled).toBe(true)
    expect(screen.getByText('Accept the notice above to ask a question')).toBeTruthy()
  })

  it('sends the question with the notice version and an Idempotency-Key, and shows the answer with its references', async () => {
    const api = apiFor()
    render(<StaffRecordChat api={api} {...props} />)
    await ready()
    ask('  What was the blood pressure?  ')
    await screen.findByText('The last blood pressure was 118 over 76.')
    expect(api.ask).toHaveBeenCalledTimes(1)
    const [question, options] = api.ask.mock.calls[0]!
    expect(question).toBe('What was the blood pressure?')
    expect(options).toMatchObject({ noticeVersion: NOTICE, maxQuestionLength: 1000 })
    expect(String(options.idempotencyKey)).toMatch(/^[A-Za-z0-9._:-]{16,128}$/)
    expect(screen.getByRole('link', { name: 'Record reference 1' })).toBeTruthy()
    expect(screen.getByText('<b>Vital signs</b>')).toBeTruthy()
    expect(document.querySelector('b')).toBeNull()
    expect(screen.getByText('Answers can be wrong. Check the record references before you rely on one.')).toBeTruthy()
  })

  it('reuses the key when the same question is sent again after a failure, and a new one for a new question', async () => {
    const api = apiFor({ ask: vi.fn().mockRejectedValueOnce(refusal(503, 'RECORD_CHAT_UNAVAILABLE')).mockResolvedValue(answer()) })
    render(<StaffRecordChat api={api} {...props} />)
    await ready()
    ask('What was the blood pressure?')
    await screen.findByText('Record chat is unavailable. Please try again later.')
    expect((asked()).value).toBe('What was the blood pressure?')
    fireEvent.click(send())
    await screen.findByText('The last blood pressure was 118 over 76.')
    expect(api.ask.mock.calls[1]![1].idempotencyKey).toBe(api.ask.mock.calls[0]![1].idempotencyKey)
    ask('And the pulse?')
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(3))
    expect(api.ask.mock.calls[2]![1].idempotencyKey).not.toBe(api.ask.mock.calls[0]![1].idempotencyKey)
  })

  it('shows nothing to ask while chat is off, and keeps the saved conversation readable and deletable', async () => {
    const api = apiFor({ availability: vi.fn().mockResolvedValue({ available: false }),
      history: vi.fn().mockResolvedValue({ conversationId: id(2), limit: 50, exchanges: [exchange(5, 'Earlier question', 'Earlier answer')] }) })
    render(<StaffRecordChat api={api} {...props} />)
    await screen.findByText(/Record chat is not available\. Your saved conversation about this patient/)
    expect(await screen.findByText('Earlier question')).toBeTruthy()
    expect(screen.queryByLabelText('Your question')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    await waitFor(() => expect(api.clear).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('Earlier question')).toBeNull())
  })

  it('lists the saved history oldest first on screen, from the newest-first answer', async () => {
    const api = apiFor({ history: vi.fn().mockResolvedValue({ conversationId: id(2), limit: 50,
      exchanges: [exchange(6, 'Second question', 'Second answer'), exchange(5, 'First question', 'First answer')] }) })
    render(<StaffRecordChat api={api} {...props} />)
    await screen.findByText('Second question')
    const questions = [...document.querySelectorAll('.record-chat-user p')].map(node => node.textContent)
    expect(questions).toEqual(['First question', 'Second question'])
  })

  it('asks for the notice again when its version changed, and refreshes availability', async () => {
    const api = apiFor({ ask: vi.fn().mockRejectedValue(refusal(428, 'CHAT_NOTICE_REQUIRED')),
      availability: vi.fn().mockResolvedValueOnce(on).mockResolvedValue({ ...on, noticeVersion: 'ADR-069@2026-11-01' }) })
    render(<StaffRecordChat api={api} {...props} />)
    await ready()
    ask('What was the blood pressure?')
    await screen.findByText(/The notice about how record chat works has changed/)
    await waitFor(() => expect(api.availability).toHaveBeenCalledTimes(2))
    expect((screen.getByRole('checkbox', { name: /I understand/ }) as HTMLInputElement).checked).toBe(false)
    expect(send().disabled).toBe(true)
  })

  it.each([
    ['RECORD_CHAT_RATE_LIMITED', 429, /20 an hour, 100 a day/],
    ['RECORD_CHAT_BUSY', 429, /Another question of yours is being answered/],
    ['RECORD_CHAT_BUDGET_EXHAUSTED', 503, /limit for today/],
    ['CHAT_HISTORY_FULL', 409, /full \(50 exchanges\)/],
    ['CHAT_SOURCES_CHANGED', 409, /A record this answer used has changed/],
    ['CHAT_CONVERSATION_CHANGED', 409, /cleared while your question/],
    ['INVALID_QUESTION', 400, /could not be sent/],
    ['PURPOSE_OF_USE_REQUIRED', 400, /direct care only/],
  ])('says what %s means', async (code, status, message) => {
    const api = apiFor({ ask: vi.fn().mockRejectedValue(refusal(status, code)) })
    render(<StaffRecordChat api={api} {...props} />)
    await ready()
    ask('What was the blood pressure?')
    expect(await screen.findByText(message)).toBeTruthy()
  })

  it.each([
    ['CONSENT_REQUIRED', 403, /Patient access has ended or changed/],
    ['BREAK_GLASS_EXCLUDED', 403, /not available under emergency access/],
  ])('reports that access ended on %s, so the chart can close the assistant', async (code, status, message) => {
    const ended = vi.fn()
    const api = apiFor({ ask: vi.fn().mockRejectedValue(refusal(status, code)) })
    render(<StaffRecordChat api={api} {...props} onAccessEnded={ended} />)
    await ready()
    ask('What was the blood pressure?')
    expect(await screen.findByText(message)).toBeTruthy()
    expect(ended).toHaveBeenCalledTimes(1)
  })

  it('reports that access ended when availability or the history is refused', async () => {
    const ended = vi.fn()
    render(<StaffRecordChat api={apiFor({ availability: vi.fn().mockRejectedValue(refusal(403, 'CONSENT_REQUIRED')) })} {...props} onAccessEnded={ended} />)
    await waitFor(() => expect(ended).toHaveBeenCalled())
    ended.mockClear()
    render(<StaffRecordChat api={apiFor({ history: vi.fn().mockRejectedValue(refusal(401, 'AUTHENTICATION_REQUIRED')) })} {...props} onAccessEnded={ended} />)
    await waitFor(() => expect(ended).toHaveBeenCalled())
  })

  it('says a legal hold keeps the saved conversation when it cannot be deleted', async () => {
    const api = apiFor({ history: vi.fn().mockResolvedValue({ conversationId: id(2), limit: 50, exchanges: [exchange(5, 'Held question', 'Held answer')] }),
      clear: vi.fn().mockRejectedValue(refusal(409, 'CHAT_HISTORY_ON_HOLD')) })
    render(<StaffRecordChat api={api} {...props} />)
    await screen.findByText('Held question')
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    await screen.findByText('A legal hold means your saved conversation cannot be deleted right now.')
    expect(screen.getByText('Held question')).toBeTruthy()
  })

  it('does not send a question over the length the service allows, or while the history is full', async () => {
    const api = apiFor({ availability: vi.fn().mockResolvedValue({ ...on, maxQuestionLength: 20, historyLimit: 1 }),
      history: vi.fn().mockResolvedValue({ conversationId: id(2), limit: 1, exchanges: [exchange(5, 'Only question', 'Only answer')] }) })
    render(<StaffRecordChat api={api} {...props} />)
    await ready()
    await screen.findByText(/Your saved conversation about this patient is full \(1 exchanges\)/)
    fireEvent.change(asked(), { target: { value: 'What was it?' } })
    expect(send().disabled).toBe(true)
    expect(asked().maxLength).toBe(20)
    expect(api.ask).not.toHaveBeenCalled()
  })

  it('shows markup in an answer as text, never as markup', async () => {
    const api = apiFor({ ask: vi.fn().mockResolvedValue(answer({ answer: 'x', blocks: [{ kind: 'record', text: '<img src=x onerror=alert(1)> done', references: [1] }] })) })
    render(<StaffRecordChat api={api} {...props} />)
    await ready()
    ask('What was it?')
    await screen.findByText('<img src=x onerror=alert(1)> done')
    expect(document.querySelector('img')).toBeNull()
  })
})
