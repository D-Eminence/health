import type * as ApiModuleNs from '../../api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Json, OpDefinition } from '@hid/offline'

type ApiModule = typeof ApiModuleNs

/**
 * A10.7: sending a lab request to Lab keeps no client key on the server, so after a lost success the replay answers
 * 412. The registry's intent and re-read let the engine call that applied ('reread') instead of opening a CC2 review,
 * when Lab already holds the request at the version sent. Compared key by key, as the engine compares an intent.
 */
const api = vi.hoisted(() => ({ records: vi.fn(), labReleasedResultsForOrder: vi.fn() }))
vi.mock('../../api', async importOriginal => {
  const original = await importOriginal<ApiModule>()
  return { ...original, staffApi: { ...original.staffApi, ...api } }
})
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
const { STAFF_OFFLINE_REGISTRY } = await import('../registry')

const toLab = (STAFF_OFFLINE_REGISTRY as unknown as readonly OpDefinition<Json>[]).find(item => item.op === 'ehr.lab-request.to-lab')!
const input = { facilityId: 'f-1', patientId: 'p-1', encounter: { server: 'enc-1' }, labRequest: { server: 'lr-1' },
  body: { expectedRowVersion: 2 } } as unknown as Json
const resolved = { encounterId: 'enc-1', targetId: 'lr-1' }
const request = { id: 'lr-1', patientId: 'p-1', encounterId: 'enc-1', createdAt: '2026-10-29T08:00:00.000Z', status: 'active', rowVersion: 2 }

/** The engine's rule: applied when every intent field equals the re-read's. */
function intentMet(current: unknown): boolean {
  const record = current as Record<string, unknown>
  return Object.entries(toLab.intent!(input)).every(([key, value]) => JSON.stringify(record[key]) === JSON.stringify(value))
}

beforeEach(() => {
  api.records.mockReset().mockResolvedValue({ items: [request], nextCursor: null })
  api.labReleasedResultsForOrder.mockReset()
})

describe('send to Lab after a lost success (A10.7)', () => {
  it('declares an intent and a re-read', () => {
    expect(toLab.method).toBe('POST')
    expect(toLab.intent!(input)).toEqual({ handedOffAtVersion: 2 })
    expect(typeof toLab.reread).toBe('function')
  })

  it('is applied when Lab already holds the request at the version sent', async () => {
    api.labReleasedResultsForOrder.mockResolvedValue({ workItemId: 'w-1', sourceEhrOrderId: 'lr-1', sourceEhrOrderVersion: '2',
      patientId: 'p-1', acceptedAt: '2026-10-29T09:00:00.000Z', test: { codeSystem: 'LOINC', code: '1', name: 'FBC' }, results: [] })
    const current = await toLab.reread!(input, resolved)
    expect(api.labReleasedResultsForOrder).toHaveBeenCalledWith('f-1', 'lr-1', 'direct-care')
    expect(current).toMatchObject({ id: 'lr-1', rowVersion: 2, handedOffAtVersion: 2 })
    expect(intentMet(current)).toBe(true)
  })

  it('goes to review when Lab holds no work item for the request (404), or holds another version', async () => {
    api.labReleasedResultsForOrder.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
    expect(intentMet(await toLab.reread!(input, resolved))).toBe(false)
    api.labReleasedResultsForOrder.mockResolvedValue({ workItemId: 'w-1', sourceEhrOrderId: 'lr-1', sourceEhrOrderVersion: 1,
      patientId: 'p-1', acceptedAt: '2026-10-29T09:00:00.000Z', test: { codeSystem: 'LOINC', code: '1', name: 'FBC' }, results: [] })
    expect(intentMet(await toLab.reread!(input, resolved))).toBe(false)
  })
})
