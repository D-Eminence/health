import { expect, it, vi } from 'vitest'
import { createRegisteredBrowserClient } from '@hid/api'
import type { ApiClient, RequestSpec } from '@hid/http'
import { createPatientApi } from '../api'

const reply = { status: 'ready', answer: 'An imported prescription is recorded.', sources: [] }
const history = { exchanges: [{ id: '00000000-0000-4000-8000-000000000001', question: 'My prescriptions?',
  reply, createdAt: '2026-10-15T10:00:00Z' }], retentionDays: 30, limit: 10 }

it('uses the actual Novu patient wire format, history retention and clear route', async () => {
  const request = vi.fn(async (spec: RequestSpec) => {
    if (spec.method === 'POST') return reply
    if (spec.method === 'DELETE') return { cleared: true }
    return history
  })
  const transport = { baseUrl: 'https://app.example.test', request } as unknown as ApiClient
  const api = createPatientApi(createRegisteredBrowserClient(transport, 'patient-web'))
  expect(await api.novuChat(' My prescriptions? ')).toEqual(reply)
  expect(await api.novuChatHistory()).toEqual(history)
  expect(await api.clearNovuChatHistory()).toEqual({ cleared: true })
  expect(request.mock.calls.map(([spec]) => [spec.method, spec.path])).toEqual([
    ['POST', '/api/v1/ehr/me/chat'], ['GET', '/api/v1/ehr/me/chat/history'], ['DELETE', '/api/v1/ehr/me/chat/history'],
  ])
  const post = request.mock.calls[0]![0]
  expect(post.body).toEqual({ question: 'My prescriptions?' })
  expect(post.timeoutMs).toBe(65_000)
  expect(post.headers?.['Idempotency-Key']).toBeUndefined()
});

it('refuses a main-only reply, malformed history and false clear acknowledgement', async () => {
  const request = vi.fn().mockResolvedValueOnce({ status: 'answered', answer: 'Main reply', sources: [] })
    .mockResolvedValueOnce({ conversationId: 'new', exchanges: [], limit: 50 })
    .mockResolvedValueOnce({ cleared: false })
  const api = createPatientApi({ request } as unknown as ApiClient)
  await expect(api.novuChat('My history?')).rejects.toThrow()
  await expect(api.novuChatHistory()).rejects.toThrow()
  await expect(api.clearNovuChatHistory()).rejects.toThrow()
});

it('rejects an oversized Novu question before transport', async () => {
  const request = vi.fn()
  const api = createPatientApi({ request } as unknown as ApiClient)
  await expect(api.novuChat('a'.repeat(501))).rejects.toThrow('500')
  expect(request).not.toHaveBeenCalled()
});
