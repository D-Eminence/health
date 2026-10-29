/**
 * The offline store: one IndexedDB database per origin (docs/OFFLINE-CONTRACT.md
 * §2.4), and the only module that opens IndexedDB (the NO_INDEXED_DB lint rule
 * is lifted for this file alone).
 *
 * Everything identifying is sealed by crypto.ts before it reaches here; the
 * plaintext fields below are the non-identifying ones the contract lists.
 *
 * Transactions: IndexedDB commits a transaction as soon as it has no pending
 * request at the end of a task, so work inside `tx()` must only await this
 * store's own requests. Encrypt and decrypt before or after, never inside.
 * Every multi-record change goes through one `tx()` call.
 */

import { DB_NAME, OFFLINE_SCHEMA, type ClockState } from './contracts'
import type { Envelope, VaultWraps } from './crypto'

export const STORES = ['meta', 'vaults', 'cache', 'outbox', 'audit', 'media', 'receipts'] as const
export type StoreName = typeof STORES[number]

export interface MetaRecord {
  id: 'device'
  v: 1
  deviceId: string
  deviceSalt: Uint8Array
  kdf: { alg: 'PBKDF2-SHA256'; iterations: number; calibratedAt: string }
  failedUnlocks: number
  lastFailureAt: string | null
}

export interface VaultRecord {
  v: 1
  vaultId: string
  appHost: string
  createdAt: string
  wraps: VaultWraps
  lease: { signedInAt: number; lastServerContactAt: number; leaseUntil: number; serverOffsetMs: number; lastWallSeen: number }
  counters: { cmdSeq: number; auditSeq: number }
  flags: { logoutPending: boolean; escrow: boolean; killed: boolean; membershipEndedAt: number | null }
  pending: { commands: number; audit: number; mediaBytes: number }
  /** Sealed with DK: VaultHeader. null once the readable copy is wiped. */
  header: Envelope | null
}

export type CacheKind = 'session' | 'index' | 'grant' | 'read'
export interface CacheRecord {
  v: 1
  vaultId: string
  tag: string
  /** Patient tag (HMAC), '' for vault-wide entries. */
  pt: string
  kind: CacheKind
  bytes: number
  savedAt: number
  /** Last read, for LRU. */
  usedAt: number
  value: Envelope
}

export type CommandState = 'queued' | 'sending' | 'applied' | 'held_access' | 'held_session' | 'held_membership' | 'review' | 'discarded'
export interface OutboxRecord {
  v: 1
  vaultId: string
  seq: number
  laneTag: string
  state: CommandState
  priority: 0 | 1 | 2
  attempts: number
  nextAttemptAt: number
  /** seq numbers of the commands this one depends on. */
  dependsOn: number[]
  everSent: boolean
  updatedAt: number
  bytes: number
  /** When this record may be deleted (applied, discarded or membership-ended), else null. */
  expiresAt: number | null
  /** Sealed with QK: Command. */
  value: Envelope
}

export interface AuditRecord {
  v: 1
  vaultId: string
  seq: number
  state: 'pending' | 'acked' | 'rejected'
  bytes: number
  rejectedAt: number | null
  /** Sealed with QK: OfflineAuditEvent. */
  value: Envelope
}

export interface MediaRecord {
  v: 1
  vaultId: string
  blobId: string
  chunkNo: number
  chunkCount: number
  bytes: number
  /** When it was staged (ms). Chunks no command refers to are deleted a day after this. */
  stagedAt: number
  /** Sealed with QK, media AAD. */
  value: Envelope
}

export interface ReceiptRecord {
  v: 1
  vaultId: string
  commandId: string
  appliedAt: number
  /** Sealed with QK: Receipt. */
  value: Envelope
}

export interface RecordFor {
  meta: MetaRecord
  vaults: VaultRecord
  cache: CacheRecord
  outbox: OutboxRecord
  audit: AuditRecord
  media: MediaRecord
  receipts: ReceiptRecord
}

export type ClockSnapshot = { clock: ClockState }

export class StoreUnavailableError extends Error {
  readonly reason: 'unsupported' | 'update-required' | 'blocked' | 'failed'
  constructor(reason: StoreUnavailableError['reason'], message?: string) {
    super(message ?? (reason === 'update-required' ? 'Update Health ID' : `Offline storage is ${reason}`))
    this.name = 'StoreUnavailableError'
    this.reason = reason
  }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'))
  })
}

/** Every key in a store that belongs to one vault (compound keys start with vaultId; arrays sort after all scalars). */
export function vaultRange(vaultId: string, ...prefix: (string | number)[]): IDBKeyRange {
  return IDBKeyRange.bound([vaultId, ...prefix], [vaultId, ...prefix, []])
}

/** Requests inside one transaction. Await only these inside `tx()`. */
export class Tx {
  constructor(private readonly t: IDBTransaction) {}

  get<S extends StoreName>(store: S, key: IDBValidKey): Promise<RecordFor[S] | undefined> {
    return req(this.t.objectStore(store).get(key)) as Promise<RecordFor[S] | undefined>
  }

  all<S extends StoreName>(store: S, range?: IDBKeyRange): Promise<RecordFor[S][]> {
    return req(this.t.objectStore(store).getAll(range)) as Promise<RecordFor[S][]>
  }

  byIndex<S extends StoreName>(store: S, index: string, range: IDBKeyRange | IDBValidKey): Promise<RecordFor[S][]> {
    return req(this.t.objectStore(store).index(index).getAll(range)) as Promise<RecordFor[S][]>
  }

  async put<S extends StoreName>(store: S, value: RecordFor[S]): Promise<void> {
    await req(this.t.objectStore(store).put(value))
  }

  async delete(store: StoreName, key: IDBValidKey | IDBKeyRange): Promise<void> {
    await req(this.t.objectStore(store).delete(key))
  }

  count(store: StoreName, range?: IDBKeyRange): Promise<number> {
    return req(this.t.objectStore(store).count(range))
  }
}

/** The browser's IndexedDB factory, if any. */
export function defaultFactory(): IDBFactory | undefined {
  return (globalThis as { indexedDB?: IDBFactory }).indexedDB
}

/**
 * Whether this origin already has the offline database, without creating it
 * (a device that never opted in keeps no database at all). Browsers without
 * `databases()` answer true, and the caller opens it.
 */
export async function databaseExists(factory: IDBFactory | undefined): Promise<boolean> {
  if (!factory) return false
  const list = (factory as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases
  if (typeof list !== 'function') return true
  try {
    return (await list.call(factory)).some(d => d.name === DB_NAME)
  } catch {
    return true
  }
}

export class OfflineStore {
  private constructor(private db: IDBDatabase) {}

  static async open(factory: IDBFactory | undefined = defaultFactory()): Promise<OfflineStore> {
    if (!factory) throw new StoreUnavailableError('unsupported')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest
      try {
        request = factory.open(DB_NAME, OFFLINE_SCHEMA)
      } catch (error) {
        reject(new StoreUnavailableError('failed', String(error)))
        return
      }
      request.onupgradeneeded = event => {
        const up = request.result
        // Version 1: created fresh. Later versions add stores or indexes only and never touch outbox, audit or media
        // records (§2.4 schema migration table).
        if (event.oldVersion < 1) {
          up.createObjectStore('meta', { keyPath: 'id' })
          up.createObjectStore('vaults', { keyPath: 'vaultId' })
          const cache = up.createObjectStore('cache', { keyPath: ['vaultId', 'tag'] })
          cache.createIndex('pt', ['vaultId', 'pt'])
          up.createObjectStore('outbox', { keyPath: ['vaultId', 'seq'] })
          up.createObjectStore('audit', { keyPath: ['vaultId', 'seq'] })
          up.createObjectStore('media', { keyPath: ['vaultId', 'blobId', 'chunkNo'] })
          up.createObjectStore('receipts', { keyPath: ['vaultId', 'commandId'] })
        }
      }
      request.onblocked = () => reject(new StoreUnavailableError('blocked'))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        const name = request.error?.name
        // An older app meeting a newer database refuses to open it: "Update Health ID".
        reject(new StoreUnavailableError(name === 'VersionError' ? 'update-required' : 'failed', request.error?.message))
      }
    })
    const store = new OfflineStore(db)
    // Another tab upgrading the schema: let it, and fail later calls cleanly.
    db.onversionchange = () => db.close()
    return store
  }

  /** Run `fn` in one transaction; resolves after the transaction commits. */
  async tx<T>(stores: readonly StoreName[], mode: IDBTransactionMode, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const t = this.db.transaction([...stores], mode, { durability: 'strict' })
    const done = new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'))
      t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'))
    })
    let result: T
    try {
      result = await fn(new Tx(t))
    } catch (error) {
      try { t.abort() } catch { /* already finished */ }
      await done.catch(() => undefined)
      throw error
    }
    await done
    return result
  }

  read<T>(stores: readonly StoreName[], fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.tx(stores, 'readonly', fn)
  }

  write<T>(stores: readonly StoreName[], fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.tx(stores, 'readwrite', fn)
  }

  /** Every record in every store, for the storage scan test and the debug storage report. */
  async dump(): Promise<Record<StoreName, unknown[]>> {
    return this.read(STORES, async tx => {
      const out = {} as Record<StoreName, unknown[]>
      for (const s of STORES) out[s] = await tx.all(s)
      return out
    })
  }

  close(): void {
    this.db.close()
  }
}
