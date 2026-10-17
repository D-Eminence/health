import { expect, it, vi } from 'vitest'
import type { ApiClient } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { createPatientApi } from '../api'
/** The patient's saved record chat as hid-system main serves it (#95, ADR-068): newest first, at most 50, no retention field. */
const id = '11111111-1111-4111-8111-111111111111'
const item = { messageId: id, question: 'Previous question', createdAt: '2026-10-12T16:00:00Z',
  reply: { status: 'answered', answer: 'An introduction.', blocks: [{ kind: 'explanation', text: 'An introduction.', references: [] }], sources: [] } }
const history = { conversationId: '22222222-2222-4222-8222-222222222222', exchanges: [item], limit: 50 }
const cleared = { cleared: true, deletedCount: 1 }
it('loads history through the authenticated self endpoint and uses DELETE for clearing', async () => {
  const request = vi.fn().mockResolvedValueOnce(history).mockResolvedValueOnce(cleared)
  const api = createPatientApi({ request } as unknown as ApiClient)
  await expect(api.chatHistory()).resolves.toEqual(history)
  await expect(api.clearChatHistory()).resolves.toEqual(cleared)
  expect(request.mock.calls[0]?.[0]).toMatchObject({ method: 'GET', path: '/api/v1/ehr/me/chat/history', auth: 'required' })
  expect(request.mock.calls[1]?.[0]).toMatchObject({ method: 'DELETE', path: '/api/v1/ehr/me/chat/history', auth: 'required' })
})
it('permits history reads and deletion through the deployed patient portal request guard', async () => {
  const request = vi.fn().mockResolvedValueOnce(history).mockResolvedValueOnce(cleared)
  const client = createRegisteredBrowserClient({ request } as unknown as ApiClient, 'patient-web')
  const api = createPatientApi(client)
  await expect(api.chatHistory()).resolves.toEqual(history)
  await expect(api.clearChatHistory()).resolves.toEqual(cleared)
  expect(request).toHaveBeenCalledTimes(2)
})
it.each(['public-web', 'staff-web', 'ehr-web', 'admin-web'] as const)(
  'does not grant patient history to the %s portal', async app => {
    const request = vi.fn()
    const client = createRegisteredBrowserClient({ request } as unknown as ApiClient, app)
    const api = createPatientApi(client)
    await expect(api.chatHistory()).rejects.toThrow(/may not call|only to the patient/)
    await expect(api.clearChatHistory()).rejects.toThrow(/may not call|only to the patient/)
    expect(request).not.toHaveBeenCalled()
  },
)
it.each([null, { ...history, exchanges: Array(101).fill(item) }, { ...history, exchanges: [item, item] },
  { ...history, exchanges: [{ ...item, question: 'x'.repeat(1001) }] },
  { ...history, exchanges: [{ ...item, reply: { ...item.reply, sources: [{ title: 'Invalid source' }] } }] },
  { ...history, exchanges: [{ ...item, reply: { ...item.reply, blocks: [{ kind: 'record', text: 'Cites nothing sent', references: [1] }] } }] },
])('rejects malformed or unbounded saved replies', async value => {
  const api = createPatientApi({ request: vi.fn().mockResolvedValue(value) } as unknown as ApiClient)
  await expect(api.chatHistory()).rejects.toThrow()
})
