/**
 * The read cache (§2.7).
 *
 * Network first: wait up to 4 s; on a timeout, a network error, 502, 503 or
 * 504, answer with the readable saved copy. The request keeps going (up to the
 * transport's own 15 s) and refreshes the saved copy and the view if it
 * returns. A successful online answer replaces the saved copy, sealed.
 *
 * Readable only when: unlocked ∧ trustedNow < leaseUntil ∧ clock ≠ suspect ∧
 * grant.readAllowed ∧ trustedNow < grant.expiresAt.
 *
 * Never cached: emergency reads, anything under a break-glass authorization,
 * and the methods in NEVER_CACHED.
 */

import { LIMITS, type CachedReads, type CachedResult, type GrantState, type PatientIndexEntry } from './contracts'
import { hmacTag, open, recordAad, seal, sha256Hex, type VaultKeys } from './crypto'
import { stableJson } from './outbox/freeze'
import { vaultRange, type CacheKind, type CacheRecord, type OfflineStore } from './store'
import { isTransportError } from './types'

export const NEVER_CACHED: ReadonlySet<string> = new Set([
  'emergencyRecords', 'importedRecords', 'importedAttachment', 'documentDownload',
])

export interface CacheHost {
  readonly store: OfflineStore
  /** The unlocked vault that may be filled, or null (locked, killed, policy off). */
  vault(): { vaultId: string; keys: VaultKeys } | null
  /** unlocked ∧ lease valid ∧ clock not suspect. */
  gateOpen(): boolean
  /** Trusted time, ms. */
  now(): number
  /** A saved copy for this patient changed (the view may refresh). */
  changed(patientId: string): void
  readonly networkFirstMs?: number
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

export type StoredIndexEntry = Omit<PatientIndexEntry, 'pendingCount'>

const encoder = new TextEncoder()

/** A failure the saved copy may stand in for: no answer, a timeout, or the gateway's 502, 503 or 504. */
export function isUnreachable(error: unknown): boolean {
  if (isTransportError(error)) return error.networkError || error.status === null || [408, 502, 503, 504].includes(error.status)
  if (error && typeof error === 'object') {
    const e = error as { status?: unknown; code?: unknown; name?: unknown }
    if (e.code === 'NETWORK_ERROR' || e.code === 'REQUEST_TIMEOUT' || e.code === 'API_ORIGIN_UNAVAILABLE') return true
    if (typeof e.status === 'number') return e.status === 0 || [408, 502, 503, 504].includes(e.status)
    if (e.name === 'TypeError') return true
  }
  return false
}

function isConsentRefusal(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { status?: unknown; code?: unknown }
  return e.status === 403 && e.code === 'CONSENT_REQUIRED'
}

export class ReadCache implements CachedReads {
  /** Patients under a break-glass authorization in this tab: nothing of theirs is written. */
  private readonly breakGlass = new Set<string>()

  constructor(private readonly host: CacheHost) {}

  private async tags(keys: VaultKeys, patientId: string, logical: string): Promise<{ tag: string; pt: string }> {
    return { tag: await hmacTag(keys.ik, logical), pt: await hmacTag(keys.ik, `patient|${patientId}`) }
  }

  private static async readKey(method: string, args: readonly unknown[]): Promise<string> {
    return `read|${method}|${await sha256Hex(stableJson(args))}`
  }

  async grant(patientId: string): Promise<GrantState | null> {
    const v = this.host.vault()
    if (!v) return null
    const tag = await hmacTag(v.keys.ik, `grant|${patientId}`)
    const rec = await this.host.store.read(['cache'], tx => tx.get('cache', [v.vaultId, tag]))
    if (!rec || rec.v !== 1) return null
    return open<GrantState>(v.keys.dk, recordAad(v.vaultId, 'cache', [v.vaultId, tag]), rec.value)
  }

  /** The full gate for one patient. Drops the patient when the grant has expired by trusted time. */
  async readable(patientId: string): Promise<boolean> {
    if (!this.host.gateOpen() || this.breakGlass.has(patientId)) return false
    const g = await this.grant(patientId)
    if (!g || !g.readAllowed || g.breakGlass) return false
    if (g.expiresAt !== null && this.host.now() >= Date.parse(g.expiresAt)) {
      await this.dropPatient(patientId)
      return false
    }
    return true
  }

  private async cached<T>(patientId: string, logical: string): Promise<CachedResult<T> | null> {
    const v = this.host.vault()
    if (!v || !(await this.readable(patientId))) return null
    const { tag } = await this.tags(v.keys, patientId, logical)
    const rec = await this.host.store.read(['cache'], tx => tx.get('cache', [v.vaultId, tag]))
    if (!rec || rec.v !== 1) return null
    const value = await open<T>(v.keys.dk, recordAad(v.vaultId, 'cache', [v.vaultId, tag]), rec.value)
    void this.host.store.write(['cache'], async tx => {
      const cur = await tx.get('cache', [v.vaultId, tag])
      if (cur) await tx.put('cache', { ...cur, usedAt: this.host.now() })
    }).catch(() => undefined)
    return { value, source: 'cache', savedAt: new Date(rec.savedAt).toISOString() }
  }

  /** May this answer be written? A grant must exist, allow reading, not be break-glass and not have expired. */
  private async fillable(patientId: string): Promise<boolean> {
    if (!this.host.vault() || this.breakGlass.has(patientId)) return false
    return this.readable(patientId)
  }

  private async put(patientId: string, logical: string, kind: CacheKind, value: unknown): Promise<void> {
    const v = this.host.vault()
    if (!v) return
    const { tag, pt } = await this.tags(v.keys, patientId, logical)
    const sealed = await seal(v.keys.dk, 'dk', recordAad(v.vaultId, 'cache', [v.vaultId, tag]), value)
    const bytes = sealed.ct.byteLength
    if (bytes > LIMITS.cachePatientMaxBytes) return
    const now = this.host.now()
    const record: CacheRecord = { v: 1, vaultId: v.vaultId, tag, pt, kind, bytes, savedAt: now, usedAt: now, value: sealed }
    await this.host.store.write(['cache'], async tx => {
      await tx.put('cache', record)
      // Per patient: 2 MB, least recently used reads go first.
      const mine = (await tx.byIndex('cache', 'pt', [v.vaultId, pt])).filter(r => r.kind === 'read')
      let total = mine.reduce((n, r) => n + r.bytes, 0)
      for (const r of mine.sort((a, b) => a.usedAt - b.usedAt)) {
        if (total <= LIMITS.cachePatientMaxBytes) break
        if (r.tag === tag) continue
        await tx.delete('cache', [v.vaultId, r.tag])
        total -= r.bytes
      }
      // Per vault: 50 MB.
      const all = (await tx.all('cache', vaultRange(v.vaultId))).filter(r => r.kind === 'read')
      let vaultTotal = all.reduce((n, r) => n + r.bytes, 0)
      for (const r of all.sort((a, b) => a.usedAt - b.usedAt)) {
        if (vaultTotal <= LIMITS.cacheVaultMaxBytes) break
        if (r.tag === tag) continue
        await tx.delete('cache', [v.vaultId, r.tag])
        vaultTotal -= r.bytes
      }
    })
  }

  async read<T>(spec: { method: string; args: readonly unknown[]; patientId: string; network: () => Promise<T>; emergency?: boolean }): Promise<CachedResult<T>> {
    // Emergency and never-cached reads go straight to the network and are kept in memory only.
    if (spec.emergency || NEVER_CACHED.has(spec.method)) return { value: await spec.network(), source: 'network', savedAt: null }
    if (!this.host.vault()) return { value: await spec.network(), source: 'network', savedAt: null }

    const logical = await ReadCache.readKey(spec.method, spec.args)
    const network = spec.network()
    const settled = network.then(
      async value => {
        if (await this.fillable(spec.patientId)) {
          await this.put(spec.patientId, logical, 'read', value).catch(() => undefined)
        }
        return value
      },
      async (error: unknown) => {
        if (isConsentRefusal(error)) await this.dropPatient(spec.patientId).catch(() => undefined)
        throw error
      },
    )

    const waitMs = this.host.networkFirstMs ?? LIMITS.networkFirstMs
    const setTimer = this.host.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
    const clearTimer = this.host.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
    let handle: unknown
    const timedOut = new Promise<'timeout'>(resolve => { handle = setTimer(() => resolve('timeout'), waitMs) })
    try {
      const first = await Promise.race([settled.then(value => ({ value }), (error: unknown) => ({ error })), timedOut])
      if (first !== 'timeout') {
        if ('value' in first) return { value: first.value, source: 'network', savedAt: null }
        if (isUnreachable(first.error)) {
          const hit = await this.cached<T>(spec.patientId, logical)
          if (hit) return hit
        }
        throw first.error
      }
      // Slow: show the saved copy now and let the request refresh it later.
      const hit = await this.cached<T>(spec.patientId, logical)
      if (hit) {
        settled.then(() => this.host.changed(spec.patientId), () => undefined)
        return hit
      }
      try {
        return { value: await settled, source: 'network', savedAt: null }
      } catch (error) {
        if (isUnreachable(error)) {
          const late = await this.cached<T>(spec.patientId, logical)
          if (late) return late
        }
        throw error
      }
    } finally {
      clearTimer(handle)
    }
  }

  async setGrant(g: GrantState): Promise<void> {
    const v = this.host.vault()
    if (g.breakGlass) {
      // A break-glass authorization: nothing about this patient stays on the device.
      this.breakGlass.add(g.patientId)
      await this.dropPatient(g.patientId)
      return
    }
    this.breakGlass.delete(g.patientId)
    if (!v) return
    if (!g.readAllowed || (g.expiresAt !== null && this.host.now() >= Date.parse(g.expiresAt))) {
      await this.dropPatient(g.patientId)
      return
    }
    await this.put(g.patientId, `grant|${g.patientId}`, 'grant', g)
    this.host.changed(g.patientId)
  }

  async dropPatient(patientId: string): Promise<void> {
    const v = this.host.vault()
    if (!v) return
    const pt = await hmacTag(v.keys.ik, `patient|${patientId}`)
    await this.host.store.write(['cache'], async tx => {
      for (const r of await tx.byIndex('cache', 'pt', [v.vaultId, pt])) await tx.delete('cache', [v.vaultId, r.tag])
    })
    await this.updateIndex(entries => entries.filter(e => e.patientId !== patientId))
    this.host.changed(patientId)
  }

  async keepOffline(_patientId: string, fetchers: readonly (() => Promise<unknown>)[]): Promise<void> {
    const queue = [...fetchers]
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await next()
    }
    await Promise.all([worker(), worker()])
  }

  // --- Patient index (sealed, vault-wide) -----------------------------------

  async index(): Promise<StoredIndexEntry[]> {
    const v = this.host.vault()
    if (!v) return []
    const tag = await hmacTag(v.keys.ik, 'index|patients')
    const rec = await this.host.store.read(['cache'], tx => tx.get('cache', [v.vaultId, tag]))
    if (!rec || rec.v !== 1) return []
    return open<StoredIndexEntry[]>(v.keys.dk, recordAad(v.vaultId, 'cache', [v.vaultId, tag]), rec.value)
  }

  private indexChain: Promise<unknown> = Promise.resolve()

  /** Serialised read-modify-write of the sealed index. */
  async updateIndex(change: (entries: StoredIndexEntry[]) => StoredIndexEntry[]): Promise<StoredIndexEntry[]> {
    const run = async () => {
      const v = this.host.vault()
      if (!v) return []
      const next = change(await this.index())
      const tag = await hmacTag(v.keys.ik, 'index|patients')
      const sealed = await seal(v.keys.dk, 'dk', recordAad(v.vaultId, 'cache', [v.vaultId, tag]), next)
      const now = this.host.now()
      await this.host.store.write(['cache'], tx => tx.put('cache', {
        v: 1, vaultId: v.vaultId, tag, pt: '', kind: 'index', bytes: sealed.ct.byteLength, savedAt: now, usedAt: now, value: sealed,
      }))
      return next
    }
    const result = this.indexChain.then(run, run)
    this.indexChain = result.catch(() => undefined)
    return result
  }

  /** Add or refresh a patient; past 100, the least recently opened patient's data is deleted. */
  async remember(entry: Omit<StoredIndexEntry, 'lastOpenedAt'>): Promise<void> {
    if (!this.host.vault() || this.breakGlass.has(entry.patientId)) return
    const lastOpenedAt = new Date(this.host.now()).toISOString()
    let evicted: string[] = []
    await this.updateIndex(entries => {
      const rest = entries.filter(e => e.patientId !== entry.patientId)
      const next = [{ ...entry, lastOpenedAt }, ...rest].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
      evicted = next.slice(LIMITS.maxPatients).map(e => e.patientId)
      return next.slice(0, LIMITS.maxPatients)
    })
    for (const id of evicted) await this.dropPatient(id)
  }

  /** Drop every patient whose grant has expired by trusted time (run on unlock and every minute). */
  async sweep(): Promise<void> {
    if (!this.host.vault()) return
    for (const e of await this.index()) await this.readable(e.patientId)
  }

  /** Size of what is cached for a vault (bytes), for diagnostics. */
  async usage(): Promise<number> {
    const v = this.host.vault()
    if (!v) return 0
    const all = await this.host.store.read(['cache'], tx => tx.all('cache', vaultRange(v.vaultId)))
    return all.reduce((n, r) => n + r.bytes, 0)
  }
}

export function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length
}
