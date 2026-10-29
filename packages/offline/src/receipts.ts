/**
 * C1 client: `POST /api/v1/ehr/offline/receipts/lookup` (§2.10). Asks whether
 * idempotency keys already completed, so a command whose earlier attempt had
 * an unknown outcome is never refused or re-entered while it may have been
 * applied (fixes F3).
 */

import { OFFLINE_PATHS } from './contracts'
import type { OfflineTransport } from './types'

export type ReceiptLookup =
  | { state: 'completed'; resourceType: string; resourceId: string; responseStatus: number; completedAt: string | null }
  | { state: 'processing' }
  | { state: 'unknown' }

interface LookupBody {
  receipts?: { key?: unknown; state?: unknown; resourceType?: unknown; resourceId?: unknown; responseStatus?: unknown; completedAt?: unknown }[]
  unknown?: unknown[]
}

const MAX_KEYS = 50

/** Look up 1..n keys (sent in batches of 50). Rejects when the lookup itself cannot be reached. */
export async function lookupReceipts(
  transport: OfflineTransport, facilityId: string, keys: readonly string[],
): Promise<Map<string, ReceiptLookup>> {
  const out = new Map<string, ReceiptLookup>()
  for (let i = 0; i < keys.length; i += MAX_KEYS) {
    const batch = keys.slice(i, i + MAX_KEYS)
    const res = await transport({
      method: 'POST', path: OFFLINE_PATHS.receipts, body: { keys: batch },
      headers: { 'X-Facility-ID': facilityId, 'X-Purpose-Of-Use': 'direct-care' },
    })
    const body = (res.body ?? {}) as LookupBody
    for (const key of batch) out.set(key, { state: 'unknown' })
    for (const r of body.receipts ?? []) {
      if (typeof r.key !== 'string' || !batch.includes(r.key)) continue
      if (r.state === 'completed' && typeof r.resourceId === 'string') {
        out.set(r.key, {
          state: 'completed',
          resourceType: typeof r.resourceType === 'string' ? r.resourceType : 'unknown',
          resourceId: r.resourceId,
          responseStatus: typeof r.responseStatus === 'number' ? r.responseStatus : 200,
          completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
        })
      } else if (r.state === 'processing' || r.state === 'pending' || r.state === 'in_progress') {
        out.set(r.key, { state: 'processing' })
      }
    }
  }
  return out
}
