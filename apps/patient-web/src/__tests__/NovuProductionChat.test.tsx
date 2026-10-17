import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionContext, createTestSessionValue } from '../session'
import { SelectedPatientChat } from '../routes/SelectedPatientChat'
import { backendContract } from '../backendContract'
import { SettingsPage } from '../routes/Portal'
import { json, profile, renderPortal } from './portalHarness'

afterEach(() => vi.unstubAllEnvs())
const patient = { kind: 'patient', subjectId: 'patient-a', appRole: 'patient', assuranceLevel: 'aal1' } as const
const empty = { exchanges: [], retentionDays: 30, limit: 10 }

it('production Novu selection loads real saved history and sends without main availability/notice calls', async () => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  const api = { novuChat: vi.fn().mockResolvedValue({ status: 'ready', answer: 'Recorded imported history.', sources: [] }),
    novuChatHistory: vi.fn().mockResolvedValue(empty), clearNovuChatHistory: vi.fn(), chatSource: vi.fn(),
    chatAvailability: vi.fn(), chat: vi.fn() }
  render(<SessionContext.Provider value={createTestSessionValue(patient, api as never)}><SelectedPatientChat /></SessionContext.Provider>)
  await waitFor(() => expect(api.novuChatHistory).toHaveBeenCalledTimes(1))
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Summarise my history' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
  expect(await screen.findByText('Recorded imported history.')).toBeTruthy()
  expect(api.novuChat.mock.calls[0]![0]).toBe('Summarise my history')
  expect(api.chatAvailability).not.toHaveBeenCalled(); expect(api.chat).not.toHaveBeenCalled()
});

it('retained patient history is cleared from the screen on account change', async () => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  const api = { novuChat: vi.fn(), novuChatHistory: vi.fn().mockResolvedValueOnce({ ...empty, exchanges: [
    { id: '00000000-0000-4000-8000-000000000001', question: 'A saved question',
      reply: { status: 'ready', answer: 'Private saved reply.', sources: [] }, createdAt: '2026-10-15T10:00:00Z' },
  ] }).mockResolvedValue(empty), clearNovuChatHistory: vi.fn(), chatSource: vi.fn() }
  const view = render(<SessionContext.Provider value={createTestSessionValue(patient, api as never)}><SelectedPatientChat /></SessionContext.Provider>)
  expect(await screen.findByText('Private saved reply.')).toBeTruthy()
  view.rerender(<SessionContext.Provider value={createTestSessionValue({ ...patient, subjectId: 'patient-b' }, api as never)}><SelectedPatientChat /></SessionContext.Provider>)
  await waitFor(() => expect(screen.queryByText('Private saved reply.')).toBeNull())
  expect(api.novuChatHistory).toHaveBeenCalledTimes(2)
});

it('rejects an unknown configured backend rather than guessing an API contract', () => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'unknown')
  expect(() => backendContract()).toThrow('Unsupported backend contract')
});

it('Novu settings retain supported controls without calling the newer account-deletion API', async () => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  const { sent } = renderPortal(<SettingsPage />, path => path.endsWith('/emergency-contacts') ? json([]) : json(profile))
  expect(await screen.findByRole('heading', { name: 'Access PIN' })).toBeTruthy()
  await waitFor(() => expect(sent.some(request => request.path.endsWith('/emergency-contacts'))).toBe(true))
  expect(sent.some(request => request.path.includes('account-deletion'))).toBe(false)
  expect(screen.queryByRole('heading', { name: /Delete.*account/i })).toBeNull()
});
