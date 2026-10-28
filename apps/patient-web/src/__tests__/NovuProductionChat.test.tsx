import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionContext, createTestSessionValue } from '../session'
import { SelectedPatientChat } from '../routes/SelectedPatientChat'
import { backendContract } from '../backendContract'
import { ProfilePage } from '../routes/Portal'
import { json, problem, profile, renderPortal, type Handler, type Sent } from './portalHarness'

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

// Novu (staging-novu-ci-20261005) serves account deletion only from hid-system 0096 (404 before it, and the card shows
// nothing), and serves emergency contacts from hid-system #109 with an availability read first. Production answers 404
// for every emergency-contact route until #109 deploys.
// On the profile, opened at the emergency contacts (Settings is gone: the owner's decision of 2026-10-28).
describe('Novu emergency contacts and account deletion on the profile', () => {
  const settings = (contacts: Handler) => renderPortal(<ProfilePage />, (path, method, body) => path === '/identity/me'
    ? json(profile) : path.startsWith('/identity/me/emergency-contacts') ? contacts(path, method, body)
      : problem(404, 'NOT_FOUND', `Cannot GET /api/v1${path}`), {}, { at: '/profile#emergency-contacts' })
  const paths = (sent: Sent[]) => sent.map(request => `${request.method} ${request.path}`)
  // The card renders nothing either way: let every answer settle before asserting what was not asked or shown.
  const settled = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  // Before 0096: the card reads its status once, is answered 404, and shows nothing.
  const noDeletion = (sent: Sent[]) => {
    expect(sent.filter(request => request.path.includes('account-deletion')).map(request => `${request.method} ${request.path}`))
      .toEqual(['GET /identity/me/account-deletion'])
    expect(screen.queryByRole('heading', { name: /Delete.*account/i })).toBeNull()
  }

  it.each([
    ['the routes are not served (404)', () => problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/identity/me/emergency-contacts/availability')],
    ['delivery is off for a patient without contacts', () => json({ delivery: false, channels: ['email'] })],
  ])('shows nothing while availability is read, nor after it says %s', async (_label, answer) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    let release!: (response: Response) => void
    const { sent } = settings(path => path.endsWith('/availability')
      ? new Promise<Response>(resolve => { release = resolve }) : json([]))
    expect(await screen.findByRole('heading', { name: 'Bio-data' })).toBeTruthy()
    await waitFor(() => expect(paths(sent)).toContain('GET /identity/me/emergency-contacts/availability'))
    const nothing = () => {
      expect(screen.queryByRole('heading', { name: 'Emergency contacts' })).toBeNull()
      expect(screen.queryByText('Loading your contacts…')).toBeNull()
    }
    nothing()
    await act(async () => { release(answer()) })
    await settled()
    nothing()
  })

  it('shows no card, no alert and reads no list while the routes are not served (404)', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const { sent } = settings(path => problem(404, 'NOT_FOUND', `Cannot GET /api/v1${path}`))
    expect(await screen.findByRole('heading', { name: 'Bio-data' })).toBeTruthy()
    await waitFor(() => expect(paths(sent)).toContain('GET /identity/me/emergency-contacts/availability'))
    await settled()
    expect(paths(sent).filter(request => request.includes('emergency-contacts'))).toEqual(['GET /identity/me/emergency-contacts/availability'])
    expect(screen.queryByRole('heading', { name: 'Emergency contacts' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    noDeletion(sent)
  })

  it('shows no card and asks to add nothing while delivery is off for a patient without contacts', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const { sent } = settings(path => path.endsWith('/availability') ? json({ delivery: false, channels: ['email'] }) : json([]))
    expect(await screen.findByRole('heading', { name: 'Bio-data' })).toBeTruthy()
    await waitFor(() => expect(paths(sent)).toContain('GET /identity/me/emergency-contacts'))
    await settled()
    expect(screen.queryByRole('heading', { name: 'Emergency contacts' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add emergency contact' })).toBeNull()
    expect(sent.some(request => request.method === 'POST')).toBe(false)
    noDeletion(sent)
  })

  it('reads availability, then loads the list into the card while delivery is on', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const { sent } = settings(path => path.endsWith('/availability') ? json({ delivery: true, channels: ['email'] }) : json([{
      contactId: 'a0000000-0000-4000-8000-000000000001', name: 'Chidi Okafor', relationship: 'sibling', channel: 'email',
      destinationHint: 'c•••@example.com', status: 'unverified', verifiedAt: null, notifyOnEmergencyAccess: true,
      eligibleForEmergencyNotification: false, version: 1, pendingVerification: null, lastNotification: null }]))
    expect(await screen.findByRole('heading', { name: 'Emergency contacts' })).toBeTruthy()
    expect(await screen.findByText('Chidi Okafor')).toBeTruthy()
    expect(paths(sent).filter(request => request.includes('emergency-contacts')))
      .toEqual(['GET /identity/me/emergency-contacts/availability', 'GET /identity/me/emergency-contacts'])
    expect(screen.getByRole('button', { name: 'Add emergency contact' })).toBeTruthy()
    noDeletion(sent)
  })
});
