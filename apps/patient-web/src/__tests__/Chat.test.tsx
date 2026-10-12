import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { PatientChat } from '../routes/Chat'
import { SessionContext, createTestSessionValue } from '../session'
import type { createPatientApi } from '../api'
import { SupportChat } from '@hid/ui'

const patient = { kind: 'patient', subjectId: 'patient-a', appRole: 'patient', assuranceLevel: 'aal1' } as const
const ready = { status: 'ready', answer: 'A released note says example [1].', sources: [
  { number: 1, noteId: 'note-a', title: '<b>Plain title</b>', revisionNo: 2, signedAt: '2026-10-07T10:00:00Z' },
] }
const apiFor = (chat: ReturnType<typeof vi.fn>) => ({ chat, chatHistory: vi.fn().mockResolvedValue({ exchanges: [], retentionDays: 30, limit: 10 }), clearChatHistory: vi.fn().mockResolvedValue({ cleared: true }) }) as unknown as ReturnType<typeof createPatientApi>
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
it('does not mount patient chat for an authenticated staff context', () => {
  const staff = { kind: 'staff', subjectId: 'staff-a', appRole: 'clinician', assuranceLevel: 'aal1',
    staffRole: 'doctor', organizationId: 'synthetic-organization' } as const
  const chat = vi.fn()
  render(<SessionContext.Provider value={createTestSessionValue(staff, apiFor(chat))}><PatientChat /></SessionContext.Provider>)
  expect(screen.queryByLabelText('Your question')).toBeNull()
  expect(chat).not.toHaveBeenCalled()
})
it('renders patient citations as text and discards content on account change or logout', async () => {
  const chat = vi.fn().mockResolvedValue(ready)
  const api = apiFor(chat)
  const view = render(<SessionContext.Provider value={createTestSessionValue(patient, api)}><PatientChat /></SessionContext.Provider>)
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: ' notes? ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
  expect(await screen.findByText(ready.answer)).toBeTruthy()
  expect(screen.getByText(/Plain title/).querySelector('b')).toBeNull()
  expect(chat.mock.calls[0]?.[0]).toBe('notes?')
  view.rerender(<SessionContext.Provider value={createTestSessionValue({ ...patient, subjectId: 'patient-b' }, api)}><PatientChat /></SessionContext.Provider>)
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  expect(screen.queryByText(ready.answer)).toBeNull()
  view.rerender(<SessionContext.Provider value={createTestSessionValue(null, api)}><PatientChat /></SessionContext.Provider>)
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  expect(screen.queryByLabelText('Your question')).toBeNull()
})
it('cancels inflight generation on unmount and prevents concurrent sends', async () => {
  const chat = vi.fn((_question: string, _options: { signal: AbortSignal }) => new Promise(() => {}))
  const view = render(<SessionContext.Provider value={createTestSessionValue(patient, apiFor(chat))}><PatientChat /></SessionContext.Provider>)
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
  expect(chat).toHaveBeenCalledTimes(1)
  const signal = chat.mock.calls[0]?.[1]?.signal as AbortSignal
  view.unmount(); expect(signal.aborted).toBe(true)
})
it('restores server history after signing out and signing back in without browser storage', async () => {
  const chat = vi.fn()
  const api = apiFor(chat)
  const saved = { exchanges: [{ id: '11111111-1111-4111-8111-111111111111', question: 'Previous question', reply: ready, createdAt: new Date().toISOString() }], retentionDays: 30, limit: 10 }
  vi.mocked(api.chatHistory).mockResolvedValue(saved)
  const browserWrite = vi.spyOn(Storage.prototype, 'setItem')
  const view = render(<SessionContext.Provider value={createTestSessionValue(patient, api)}><PatientChat /></SessionContext.Provider>)
  expect(await screen.findByText('Previous question')).toBeTruthy()
  view.rerender(<SessionContext.Provider value={createTestSessionValue(null, api)}><PatientChat /></SessionContext.Provider>)
  expect(screen.queryByText('Previous question')).toBeNull()
  view.rerender(<SessionContext.Provider value={createTestSessionValue(patient, api)}><PatientChat /></SessionContext.Provider>)
  expect(await screen.findByText('Previous question')).toBeTruthy()
  expect(api.chatHistory).toHaveBeenCalledTimes(2)
  expect(browserWrite).not.toHaveBeenCalled()
  browserWrite.mockRestore()
})
it('blocks sends while history loads and ignores a late history reply after account change', async () => {
  const api = apiFor(vi.fn())
  let resolve!: (value: Awaited<ReturnType<typeof api.chatHistory>>) => void
  vi.mocked(api.chatHistory).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const view = render(<SessionContext.Provider value={createTestSessionValue(patient, api)}><PatientChat /></SessionContext.Provider>)
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Wait' } })
  fireEvent.keyDown(screen.getByLabelText('Your question'), { key: 'Enter' })
  expect(api.chat).not.toHaveBeenCalled()
  view.rerender(<SessionContext.Provider value={createTestSessionValue({ ...patient, subjectId: 'patient-b' }, api)}><PatientChat /></SessionContext.Provider>)
  resolve({ exchanges: [{ id: '11111111-1111-4111-8111-111111111111', question: 'Another patient private question', reply: ready, createdAt: new Date().toISOString() }], retentionDays: 30, limit: 10 })
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  expect(screen.queryByText('Another patient private question')).toBeNull()
})
it('keeps history visible and reports failure if deletion is not confirmed', async () => {
  const api = apiFor(vi.fn())
  vi.mocked(api.chatHistory).mockResolvedValue({ exchanges: [{ id: '11111111-1111-4111-8111-111111111111', question: 'Saved question', reply: ready, createdAt: new Date().toISOString() }], retentionDays: 30, limit: 10 })
  vi.mocked(api.clearChatHistory).mockRejectedValue(new Error('network unavailable'))
  render(<SessionContext.Provider value={createTestSessionValue(patient, api)}><PatientChat /></SessionContext.Provider>)
  expect(await screen.findByText('Saved question')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  expect((await screen.findByRole('alert')).textContent).toContain('could not be deleted')
  expect(screen.getByText('Saved question')).toBeTruthy()
})
it('suggestions prepare a question for explicit sending and focus the composer', async () => {
  const chat = vi.fn()
  render(<SessionContext.Provider value={createTestSessionValue(patient, apiFor(chat))}><PatientChat /></SessionContext.Provider>)
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /Summarise my notes/ }))
  const input = screen.getByLabelText('Your question') as HTMLTextAreaElement
  expect(input.value).toBe('Summarise my latest released clinical notes.')
  expect(document.activeElement).toBe(input)
  expect(chat).not.toHaveBeenCalled()
})
it('shows the sent question immediately and keeps a new draft while a reply is pending', async () => {
  let resolve!: (value: typeof ready) => void
  const chat = vi.fn(() => new Promise<typeof ready>(done => { resolve = done }))
  render(<SessionContext.Provider value={createTestSessionValue(patient, apiFor(chat))}><PatientChat /></SessionContext.Provider>)
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  const input = screen.getByLabelText('Your question') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: 'My first question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
  expect(screen.getByRole('log').textContent).toContain('My first question')
  expect(screen.getByRole('status').textContent).toContain('Reading your released notes')
  expect(input.value).toBe('')
  fireEvent.change(input, { target: { value: 'My next question' } })
  resolve(ready)
  expect(await screen.findByText(ready.answer)).toBeTruthy()
  expect(input.value).toBe('My next question')
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByText(/Revision 2 · Signed/)).toBeTruthy()
})
it('new conversation cancels old work and ignores late replies without unlocking a new send', async () => {
  const pending: Array<(value: typeof ready) => void> = []
  const chat = vi.fn((_question: string, _options: { signal: AbortSignal }) => new Promise<typeof ready>(done => pending.push(done)))
  render(<SessionContext.Provider value={createTestSessionValue(patient, apiFor(chat))}><PatientChat /></SessionContext.Provider>)
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  const input = screen.getByLabelText('Your question') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: 'Old question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  expect(chat.mock.calls[0]?.[1].signal.aborted).toBe(true)
  await waitFor(() => expect(screen.queryByText('Old question')).toBeNull())
  expect(input.value).toBe('')
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: 'New question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
  pending[0]?.({ ...ready, answer: 'Late old reply' })
  await waitFor(() => expect(screen.queryByText('Late old reply')).toBeNull())
  expect((screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement).disabled).toBe(true)
  pending[1]?.(ready)
  expect(await screen.findByText(ready.answer)).toBeTruthy()
  expect(screen.getByRole('log').textContent).toContain('New question')
})
it('Enter sends, Shift+Enter keeps multiline editing, and oversized questions do not send', async () => {
  const chat = vi.fn().mockResolvedValue(ready)
  render(<SessionContext.Provider value={createTestSessionValue(patient, apiFor(chat))}><PatientChat /></SessionContext.Provider>)
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  const input = screen.getByLabelText('Your question')
  fireEvent.change(input, { target: { value: 'A question' } })
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
  expect(chat).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(await screen.findByText(ready.answer)).toBeTruthy()
  expect(chat).toHaveBeenCalledTimes(1)
  fireEvent.change(input, { target: { value: 'x'.repeat(501) } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(chat).toHaveBeenCalledTimes(1)
})
it.each([
  [401, 'UNAUTHENTICATED', 'Your session ended. Please sign in again.'],
  [403, 'FORBIDDEN', 'You do not have access to patient record chat.'],
  [409, 'CHAT_SOURCES_CHANGED', 'Your records changed. Please ask your question again.'],
  [429, 'PATIENT_CHAT_RATE_LIMITED', 'Please wait before asking another question.'],
  [503, 'PATIENT_CHAT_DISABLED', 'Record chat is not enabled yet.'],
  [0, 'REQUEST_TIMEOUT', 'The reply took too long. Please try later.'],
])('shows safe patient error %s without retrying', async (status, code, message) => {
  const chat = vi.fn().mockRejectedValue(new HidApiError(status, 'Private provider detail', { code }))
  render(<SessionContext.Provider value={createTestSessionValue(patient, apiFor(chat))}><PatientChat /></SessionContext.Provider>)
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
  expect((await screen.findByRole('alert')).textContent).toBe(message)
  expect(chat).toHaveBeenCalledTimes(1)
})
it.each(['preparing', 'ready'])('shows %s empty-source answers without inventing citations', async status => {
  const chat = vi.fn().mockResolvedValue({ status, answer: 'No released clinical notes.', sources: [] })
  render(<SessionContext.Provider value={createTestSessionValue(patient, apiFor(chat))}><PatientChat /></SessionContext.Provider>)
  await waitFor(() => expect(screen.queryByText(/Loading your saved conversation/)).toBeNull())
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
  expect(await screen.findByText('No released clinical notes.')).toBeTruthy()
  expect(screen.queryByText('Sources')).toBeNull()
})
it('support reuses a session, renders plain text, resets and restores launcher focus', async () => {
  const sessionId = '11111111-1111-4111-8111-111111111111'
  const send = vi.fn().mockResolvedValue({ sessionId, messages: ['<img src=x onerror=alert(1)>'] })
  render(<SupportChat contact="mailto:support@healthidentitydirectory.com" send={send} />)
  const launcher = screen.getByRole('button', { name: 'Support chat' }); fireEvent.click(launcher)
  const input = screen.getByLabelText('Your question')
  expect(document.activeElement).toBe(input)
  for (let i = 0; i < 2; i++) {
    fireEvent.change(input, { target: { value: 'Help' } }); fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false))
  }
  expect(send.mock.calls[1]?.[1]).toBe(sessionId)
  expect(screen.getByRole('log').querySelector('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Start new chat' }))
  expect(screen.queryByText('<img src=x onerror=alert(1)>')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Close' })); expect(document.activeElement).toBe(launcher)
})
it('support offers the approved fallback on rate limit without resending', async () => {
  const send = vi.fn().mockRejectedValue(new HidApiError(429, 'Limit'))
  render(<SupportChat contact="mailto:support@healthidentitydirectory.com" send={send} />)
  fireEvent.click(screen.getByRole('button', { name: 'Support chat' }))
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Help' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Please wait')
  expect(screen.getByRole('link', { name: 'Email support' }).getAttribute('href')).toBe('mailto:support@healthidentitydirectory.com')
  expect(send).toHaveBeenCalledTimes(1)
})
