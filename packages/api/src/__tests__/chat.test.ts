import { expect, it, vi } from 'vitest'
import { createHidApi } from '../index'
import { createApiClient, type ApiClient } from '@hid/http'

it('forwards cancellation and distinct timeouts without sending a patient identifier', async () => {
  const request = vi.fn().mockResolvedValueOnce({ sessionId: '11111111-1111-4111-8111-111111111111', messages: ['FAQ'] })
    .mockResolvedValueOnce({ status: 'ready', answer: 'No notes.', sources: [] })
  const api = createHidApi({ app: 'patient-web', client: { request } as unknown as ApiClient })
  const controller = new AbortController()
  await api.support.chat(' help ', undefined, { signal: controller.signal })
  await api.ehr.chat(' notes ', { signal: controller.signal })
  expect(request.mock.calls[0]?.[0]).toMatchObject({ auth: 'none', timeoutMs: 10000, signal: controller.signal, body: { text: 'help' } })
  expect(request.mock.calls[1]?.[0]).toMatchObject({ auth: 'required', timeoutMs: 65000, signal: controller.signal, body: { question: 'notes' } })
})

it('keeps patient CSRF and cookies; provider failures do not retry chat POSTs', async () => {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ detail: 'Unavailable' }), { status: 503 }))
  const client = createApiClient({ baseUrl: 'https://staging.example', clientId: 'patient-web', sessionMode: 'cookie',
    getCsrfToken: () => 'csrf-example', fetchImpl: fetchImpl as typeof fetch })
  const api = createHidApi({ app: 'patient-web', client })
  await expect(api.ehr.chat('Question')).rejects.toMatchObject({ status: 503 })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
  expect(init.credentials).toBe('include')
  expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-example')
})
