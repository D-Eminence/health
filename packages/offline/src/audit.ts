/**
 * Offline audit queue and C2 client (§2.10 C2, §2.11).
 *
 * Offline chart opens, unlocks, wipes and discards are recorded locally,
 * sealed with QK, with a monotonic `seq` per vault so the server can detect
 * gaps. They survive sign-out and wipes and are never deleted before the
 * server acknowledges them. On reconnect they are sent in batches of 20 (to
 * stay under the 8 KB edge limit); `accepted` and `duplicate` are deleted, a
 * `rejected` event is kept 7 days and then dropped with a report.
 */

import { LIMITS, OFFLINE_PATHS, type ClockState, type Json, type OfflineAudit, type OfflineAuditEvent } from './contracts'
import { open, randomUuid, recordAad, seal, type VaultKeys } from './crypto'
import { vaultRange, type AuditRecord, type OfflineStore } from './store'
import type { OfflineReport, OfflineTransport } from './types'
import { recountPending } from './vault'

export const AUDIT_SECTIONS: ReadonlySet<string> = new Set([
  'consent', 'encounters', 'encounter', 'clinical-notes', 'vitals', 'diagnoses', 'prescriptions', 'lab-requests', 'documents',
  'note-revisions', 'vital-corrections', 'reported-health', 'lab-results', 'summary',
])

const MERGE_MS = 10 * 60_000
const REJECTED_KEEP_MS = 7 * 86400_000

export interface AuditHost {
  readonly store: OfflineStore
  readonly transport: OfflineTransport
  vault(): { vaultId: string; keys: VaultKeys; facilityId: string } | null
  /** Recording is allowed (unlocked). Sending also needs canSend. */
  canSend(): boolean
  now(): number
  clock(): ClockState
  grantExpiresAt(patientId: string): Promise<string | null>
  changed(): void
  readonly report?: (e: OfflineReport) => void
}

function auditAad(vaultId: string, seq: number): string {
  return recordAad(vaultId, 'audit', [vaultId, seq])
}

export class AuditQueue implements OfflineAudit {
  /** `<patientId>|<section>` → last recorded open (trusted ms), for the 10-minute merge. */
  private readonly recent = new Map<string, number>()
  private flushing: Promise<void> | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly host: AuditHost) {}

  /**
   * Call when a chart section is shown from the saved copy (useCachedRead does
   * this for `source: 'cache'`). Online reads are audited by the server already.
   */
  recordOpen(patientId: string, section: string, resourceId?: string): void {
    if (!this.host.vault()) return
    if (!AUDIT_SECTIONS.has(section)) return
    const key = `${patientId}|${section}`
    const now = this.host.now()
    const last = this.recent.get(key)
    if (last !== undefined && now - last < MERGE_MS) return
    this.recent.set(key, now)
    void this.host.grantExpiresAt(patientId).then(grantExpiresAt => this.record({
      action: 'ehr.record.read', patientId, section, resourceId: resourceId ?? null, grantExpiresAt,
    })).catch(() => undefined)
  }

  /** Append one event. Serialised per tab; `seq` is reserved in its own transaction before sealing. */
  record(e: { action: OfflineAuditEvent['action']; patientId: string | null; section: string | null; resourceId?: string | null
    grantExpiresAt?: string | null; details?: Json }): Promise<void> {
    const run = async () => {
      const v = this.host.vault()
      if (!v) return
      const seq = await this.host.store.write(['vaults'], async tx => {
        const r = await tx.get('vaults', v.vaultId)
        if (!r) throw new Error('Vault disappeared')
        const next = r.counters.auditSeq + 1
        await tx.put('vaults', { ...r, counters: { ...r.counters, auditSeq: next } })
        return next
      })
      const event: OfflineAuditEvent = {
        eventId: randomUuid(), seq, action: e.action, patientId: e.patientId, section: e.section, resourceId: e.resourceId ?? null,
        occurredAt: new Date(this.host.now()).toISOString(), clock: this.host.clock(), grantExpiresAt: e.grantExpiresAt ?? null,
        ...(e.details !== undefined ? { details: e.details } : {}),
      }
      const value = await seal(v.keys.qk, 'qk', auditAad(v.vaultId, seq), event)
      const rec: AuditRecord = { v: 1, vaultId: v.vaultId, seq, state: 'pending', bytes: value.ct.byteLength, rejectedAt: null, value }
      await this.host.store.write(['vaults', 'outbox', 'audit', 'media'], async tx => {
        await tx.put('audit', rec)
        await recountPending(tx, v.vaultId)
      })
      this.host.changed()
    }
    const p = this.chain.then(run, run)
    this.chain = p.catch(() => undefined)
    return p
  }

  async pending(): Promise<OfflineAuditEvent[]> {
    const v = this.host.vault()
    if (!v) return []
    const recs = await this.host.store.read(['audit'], tx => tx.all('audit', vaultRange(v.vaultId)))
    const out: OfflineAuditEvent[] = []
    for (const r of recs) if (r.v === 1 && r.state === 'pending') out.push(await open<OfflineAuditEvent>(v.keys.qk, auditAad(v.vaultId, r.seq), r.value))
    return out
  }

  /** Send everything pending, 20 at a time. Safe to call often; one flush runs at a time. */
  flush(): Promise<void> {
    this.flushing ??= this.flushOnce().finally(() => { this.flushing = null })
    return this.flushing
  }

  private async flushOnce(): Promise<void> {
    for (let round = 0; round < 50; round += 1) {
      const v = this.host.vault()
      if (!v || !this.host.canSend()) return
      const recs = await this.host.store.read(['audit'], tx => tx.all('audit', vaultRange(v.vaultId)))
      const now = this.host.now()
      const expiredRejected = recs.filter(r => r.state === 'rejected' && r.rejectedAt !== null && now - r.rejectedAt >= REJECTED_KEEP_MS)
      if (expiredRejected.length > 0) {
        await this.host.store.write(['vaults', 'outbox', 'audit', 'media'], async tx => {
          for (const r of expiredRejected) await tx.delete('audit', [v.vaultId, r.seq])
          await recountPending(tx, v.vaultId)
        })
        this.host.report?.({ kind: 'audit-rejected', dropped: expiredRejected.length, code: 'EXPIRED' })
      }
      const candidates = recs.filter(r => r.v === 1 && r.state === 'pending').sort((a, b) => a.seq - b.seq).slice(0, LIMITS.auditBatch)
      if (candidates.length === 0) return
      const opened: OfflineAuditEvent[] = []
      for (const r of candidates) opened.push(await open<OfflineAuditEvent>(v.keys.qk, auditAad(v.vaultId, r.seq), r.value))
      const events = fitAuditBatch(v.vaultId, opened)
      const batch = candidates.slice(0, events.length)
      let body: { accepted?: unknown; duplicate?: unknown; rejected?: unknown }
      try {
        const res = await this.host.transport({
          method: 'POST', path: OFFLINE_PATHS.audit,
          body: { vaultId: v.vaultId, events: events as unknown as Json },
          headers: { 'X-Facility-ID': v.facilityId, 'X-Purpose-Of-Use': 'direct-care' },
        })
        body = (res.body ?? {}) as typeof body
      } catch {
        return // Retried on the next pump.
      }
      const ids = (x: unknown) => new Set(Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : [])
      const done = new Set([...ids(body.accepted), ...ids(body.duplicate)])
      const rejected = new Map<string, string>()
      if (Array.isArray(body.rejected)) {
        for (const r of body.rejected as { eventId?: unknown; code?: unknown }[]) {
          if (typeof r?.eventId === 'string') rejected.set(r.eventId, typeof r.code === 'string' ? r.code : 'INVALID_EVENT')
        }
      }
      let progressed = 0
      await this.host.store.write(['vaults', 'outbox', 'audit', 'media'], async tx => {
        for (let i = 0; i < batch.length; i += 1) {
          const r = batch[i]!
          const id = events[i]!.eventId
          if (done.has(id)) { await tx.delete('audit', [v.vaultId, r.seq]); progressed += 1 }
          else if (rejected.has(id)) { await tx.put('audit', { ...r, state: 'rejected', rejectedAt: now }); progressed += 1 }
        }
        await recountPending(tx, v.vaultId)
      })
      this.host.changed()
      if (progressed === 0) return
    }
  }
}

const encoder = new TextEncoder()
const bodySize = (vaultId: string, events: readonly OfflineAuditEvent[]) => encoder.encode(JSON.stringify({ vaultId, events })).length

/**
 * The events for one C2 request, in seq order: at most 20, and only while the request body stays within 8000
 * bytes (the edge refuses larger bodies with a 403). The first event always goes; if it is too large on its own,
 * a copy is sent with `details.reason` cut to fit and `details.reasonTruncated: true` (the sealed record is not
 * changed).
 */
export function fitAuditBatch(vaultId: string, events: readonly OfflineAuditEvent[]): OfflineAuditEvent[] {
  const out: OfflineAuditEvent[] = []
  for (const e of events.slice(0, LIMITS.auditBatch)) {
    if (bodySize(vaultId, [...out, e]) <= LIMITS.maxBodyBytes) { out.push(e); continue }
    if (out.length === 0) out.push(truncated(vaultId, e))
    break
  }
  return out
}

function truncated(vaultId: string, e: OfflineAuditEvent): OfflineAuditEvent {
  const details = (e.details && typeof e.details === 'object' && !Array.isArray(e.details) ? e.details : {}) as Record<string, Json>
  const reason = typeof details.reason === 'string' ? details.reason : ''
  const withReason = (r: string): OfflineAuditEvent => ({ ...e, details: { ...details, reason: r, reasonTruncated: true } })
  let lo = 0
  let hi = reason.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (bodySize(vaultId, [withReason(reason.slice(0, mid))]) <= LIMITS.maxBodyBytes) lo = mid
    else hi = mid - 1
  }
  return withReason(reason.slice(0, lo))
}
