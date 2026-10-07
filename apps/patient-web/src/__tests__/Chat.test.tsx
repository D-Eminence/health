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
const apiFor = (chat: ReturnType<typeof vi.fn>) => ({ chat }) as unknown as ReturnType<typeof createPatientApi>
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
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: ' notes? ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask about my records' }))
  expect(await screen.findByText(ready.answer)).toBeTruthy()
  expect(screen.getByText(/Plain title/).querySelector('b')).toBeNull()
  expect(chat.mock.calls[0]?.[0]).toBe('notes?')
  view.rerender(<SessionContext.Provider value={createTestSessionValue({ ...patient, subjectId: 'patient-b' }, api)}><PatientChat /></SessionContext.Provider>)
  expect(screen.queryByText(ready.answer)).toBeNull()
  view.rerender(<SessionContext.Provider value={createTestSessionValue(null, api)}><PatientChat /></SessionContext.Provider>)
  expect(screen.queryByLabelText('Your question')).toBeNull()
})
it('cancels inflight generation on unmount and prevents concurrent sends', async () => {
  const chat = vi.fn((_question: string, _options: { signal: AbortSignal }) => new Promise(() => {}))
  const view = render(<SessionContext.Provider value={createTestSessionValue(patient, apiFor(chat))}><PatientChat /></SessionContext.Provider>)
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask about my records' }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask about my records' }))
  expect(chat).toHaveBeenCalledTimes(1)
  const signal = chat.mock.calls[0]?.[1]?.signal as AbortSignal
  view.unmount(); expect(signal.aborted).toBe(true)
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
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask about my records' }))
  expect((await screen.findByRole('alert')).textContent).toBe(message)
  expect(chat).toHaveBeenCalledTimes(1)
})
it.each(['preparing', 'ready'])('shows %s empty-source answers without inventing citations', async status => {
  const chat = vi.fn().mockResolvedValue({ status, answer: 'No released clinical notes.', sources: [] })
  render(<SessionContext.Provider value={createTestSessionValue(patient, apiFor(chat))}><PatientChat /></SessionContext.Provider>)
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask about my records' }))
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
