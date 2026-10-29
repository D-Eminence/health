/**
 * Vaults (§2.4, §2.5, §2.6): one per account, facility and app host on this
 * origin, at most five. Create, find with a KEK, open, wipe, delete, the
 * device-wide failed-unlock counter, and the escrow re-wrap after a password
 * change.
 *
 * A vault's plaintext record holds no identifiers: which account a vault
 * belongs to is learned only by unwrapping its DK with that account's KEK and
 * opening the sealed header.
 */

import { LIMITS, type StaffSessionSnapshot } from './contracts'
import {
  addEscrowWrap,
  calibrateIterations,
  createVaultKeys,
  deriveKek,
  kekOpens,
  kekSalt,
  open as openSealed,
  randomBytes,
  randomUuid,
  recordAad,
  rewrapWithEscrow,
  seal,
  unwrapVaultKeys,
  type VaultKeys,
} from './crypto'
import { leaseUntil } from './lease'
import { vaultRange, type MetaRecord, type OfflineStore, type Tx, type VaultRecord } from './store'

export type VaultHeader = StaffSessionSnapshot

export interface OpenVault {
  record: VaultRecord
  keys: VaultKeys
  /** null after a cache wipe: the vault can send its queue but not restore a session offline. */
  header: VaultHeader | null
}

export class VaultLimitError extends Error {
  constructor() {
    super('Every offline copy on this device still has unsent work, so another cannot be added.')
    this.name = 'VaultLimitError'
  }
}

/** Stores holding work that must survive a sign-out or a wipe. */
const KEPT_STORES = ['outbox', 'audit', 'media', 'receipts'] as const

export function headerAad(vaultId: string): string {
  return recordAad(vaultId, 'vaults', [vaultId, 'header'])
}

export function hasPendingWork(r: VaultRecord): boolean {
  return r.pending.commands > 0 || r.pending.audit > 0 || r.pending.mediaBytes > 0
}

/** Recount a vault's pending work inside a write transaction and store it on the vault record. */
export async function recountPending(tx: Tx, vaultId: string): Promise<VaultRecord | undefined> {
  const record = await tx.get('vaults', vaultId)
  if (!record) return undefined
  const outbox = await tx.all('outbox', vaultRange(vaultId))
  const audit = await tx.all('audit', vaultRange(vaultId))
  const media = await tx.all('media', vaultRange(vaultId))
  const commands = outbox.filter(o => o.state !== 'applied' && o.state !== 'discarded').length
  const next: VaultRecord = {
    ...record,
    pending: {
      commands,
      audit: audit.filter(a => a.state === 'pending').length,
      mediaBytes: media.reduce((n, m) => n + m.bytes, 0),
    },
  }
  await tx.put('vaults', next)
  return next
}

export interface VaultDeps {
  readonly appHost: string
  /** Trusted time in ms. */
  readonly now: () => number
  readonly calibrate?: () => Promise<number>
}

export class Vaults {
  constructor(private readonly store: OfflineStore, private readonly deps: VaultDeps) {}

  /** The device record, created (and the KDF calibrated) on first use. */
  async meta(): Promise<MetaRecord> {
    const existing = await this.store.read(['meta'], tx => tx.get('meta', 'device'))
    if (existing) return existing
    const iterations = await (this.deps.calibrate ?? calibrateIterations)()
    const fresh: MetaRecord = {
      id: 'device', v: 1, deviceId: randomUuid(), deviceSalt: randomBytes(16),
      kdf: { alg: 'PBKDF2-SHA256', iterations, calibratedAt: new Date(this.deps.now()).toISOString() },
      failedUnlocks: 0, lastFailureAt: null,
    }
    // Another tab may have won the race; keep whichever landed first.
    return this.store.write(['meta'], async tx => {
      const raced = await tx.get('meta', 'device')
      if (raced) return raced
      await tx.put('meta', fresh)
      return fresh
    })
  }

  async deriveKek(email: string, password: string): Promise<CryptoKey> {
    const meta = await this.meta()
    return deriveKek(password, await kekSalt(meta.deviceSalt, email), meta.kdf.iterations)
  }

  async list(): Promise<VaultRecord[]> {
    const all = await this.store.read(['vaults'], tx => tx.all('vaults'))
    // A record from a newer schema is left unread and kept (§2.4).
    return all.filter(v => v.v === 1 && v.appHost === this.deps.appHost)
  }

  /** Every vault on this app host the KEK opens (one account can have one per facility). */
  async openWith(kek: CryptoKey): Promise<OpenVault[]> {
    const out: OpenVault[] = []
    for (const record of await this.list()) {
      if (!(await kekOpens(kek, record.vaultId, record.wraps.dk))) continue
      out.push(await this.unwrap(kek, record))
    }
    return out
  }

  async unwrap(kek: CryptoKey, record: VaultRecord): Promise<OpenVault> {
    const keys = await unwrapVaultKeys(kek, record.vaultId, record.wraps)
    const header = record.header ? await openSealed<VaultHeader>(keys.dk, headerAad(record.vaultId), record.header) : null
    return { record, keys, header }
  }

  /** Create a vault for a session. Evicts the oldest vault with nothing pending past five; refuses if none can go. */
  async create(kek: CryptoKey, session: StaffSessionSnapshot, escrow?: { key: CryptoKey; keyVersion: number }): Promise<OpenVault> {
    return this.createWithId(kek, randomUuid(), session, escrow)
  }

  /** As `create`, with the id chosen first (the escrow key is derived for a vault id). */
  async createWithId(kek: CryptoKey, vaultId: string, session: StaffSessionSnapshot, escrow?: { key: CryptoKey; keyVersion: number }): Promise<OpenVault> {
    const { wraps, keys } = await createVaultKeys(kek, vaultId, escrow)
    const header = await seal(keys.dk, 'dk', headerAad(vaultId), session)
    const now = this.deps.now()
    const record: VaultRecord = {
      v: 1, vaultId, appHost: this.deps.appHost, createdAt: new Date(now).toISOString(), wraps,
      lease: { signedInAt: now, lastServerContactAt: now, leaseUntil: leaseUntil(now, now), serverOffsetMs: 0, lastWallSeen: 0 },
      counters: { cmdSeq: 0, auditSeq: 0 },
      flags: { logoutPending: false, escrow: escrow !== undefined, killed: false, membershipEndedAt: null },
      pending: { commands: 0, audit: 0, mediaBytes: 0 },
      header,
    }
    await this.store.write(['vaults', 'cache', ...KEPT_STORES], async tx => {
      const existing = (await tx.all('vaults')).filter(v => v.appHost === this.deps.appHost)
      if (existing.length >= LIMITS.maxVaultsPerOrigin) {
        const evictable = existing.filter(v => !hasPendingWork(v)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        const victim = evictable[0]
        if (!victim) throw new VaultLimitError()
        await deleteVaultIn(tx, victim.vaultId)
      }
      await tx.put('vaults', record)
    })
    return { record, keys, header: session }
  }

  /** Reseal the header after an online sign-in (the session snapshot may have changed). */
  async writeHeader(open: OpenVault, session: StaffSessionSnapshot, lease: VaultRecord['lease']): Promise<OpenVault> {
    const header = await seal(open.keys.dk, 'dk', headerAad(open.record.vaultId), session)
    const record = await this.store.write(['vaults'], async tx => {
      const current = await tx.get('vaults', open.record.vaultId)
      if (!current) throw new Error('Vault disappeared')
      const next: VaultRecord = { ...current, header, lease, flags: { ...current.flags, logoutPending: false, killed: false } }
      await tx.put('vaults', next)
      return next
    })
    return { ...open, record, header: session }
  }

  async addEscrow(kek: CryptoKey, open: OpenVault, escrow: { key: CryptoKey; keyVersion: number }): Promise<OpenVault> {
    const qkEsc = await addEscrowWrap(kek, open.record.vaultId, open.record.wraps.qkPw, escrow)
    const record = await this.update(open.record.vaultId, r => ({ ...r, wraps: { ...r.wraps, qkEsc }, flags: { ...r.flags, escrow: true } }))
    return { ...open, record }
  }

  /**
   * Password changed online: QK through escrow, new DK and IK, everything
   * wrapped under the new KEK. The old cache (sealed with the old DK) is
   * deleted in the same transaction. Returns null when escrow does not open it.
   */
  async rewrapAfterPasswordChange(newKek: CryptoKey, record: VaultRecord, escrowKey: CryptoKey, session: StaffSessionSnapshot): Promise<OpenVault | null> {
    if (!record.wraps.qkEsc) return null
    let rewrapped: Awaited<ReturnType<typeof rewrapWithEscrow>>
    try {
      rewrapped = await rewrapWithEscrow(newKek, record.vaultId, record.wraps.qkEsc, escrowKey)
    } catch {
      return null
    }
    const header = await seal(rewrapped.keys.dk, 'dk', headerAad(record.vaultId), session)
    const next = await this.store.write(['vaults', 'cache'], async tx => {
      await tx.delete('cache', vaultRange(record.vaultId))
      const current = await tx.get('vaults', record.vaultId)
      if (!current) throw new Error('Vault disappeared')
      const updated: VaultRecord = { ...current, wraps: rewrapped.wraps, header }
      await tx.put('vaults', updated)
      return updated
    })
    return { record: next, keys: rewrapped.keys, header: session }
  }

  async update(vaultId: string, change: (r: VaultRecord) => VaultRecord): Promise<VaultRecord> {
    return this.store.write(['vaults'], async tx => {
      const current = await tx.get('vaults', vaultId)
      if (!current) throw new Error('Vault disappeared')
      const next = change(current)
      await tx.put('vaults', next)
      return next
    })
  }

  async get(vaultId: string): Promise<VaultRecord | undefined> {
    return this.store.read(['vaults'], tx => tx.get('vaults', vaultId))
  }

  /** Device-wide count of consecutive failed offline unlocks. Returns the new count. */
  async recordFailure(): Promise<number> {
    await this.meta()
    return this.store.write(['meta'], async tx => {
      const meta = (await tx.get('meta', 'device'))!
      const next: MetaRecord = { ...meta, failedUnlocks: meta.failedUnlocks + 1, lastFailureAt: new Date(this.deps.now()).toISOString() }
      await tx.put('meta', next)
      return next.failedUnlocks
    })
  }

  async clearFailures(): Promise<void> {
    await this.store.write(['meta'], async tx => {
      const meta = await tx.get('meta', 'device')
      if (meta && meta.failedUnlocks !== 0) await tx.put('meta', { ...meta, failedUnlocks: 0, lastFailureAt: null })
    })
  }

  /**
   * Wipe the readable copy: every cache record and the sealed header. Outbox,
   * audit, media and receipts are kept (§2.6 wipe triggers).
   */
  async wipeCache(vaultIds: readonly string[], o: { logoutPending?: boolean; killed?: boolean } = {}): Promise<void> {
    await this.store.write(['vaults', 'cache'], async tx => {
      for (const vaultId of vaultIds) {
        await tx.delete('cache', vaultRange(vaultId))
        const current = await tx.get('vaults', vaultId)
        if (!current) continue
        await tx.put('vaults', {
          ...current, header: null,
          flags: {
            ...current.flags,
            ...(o.logoutPending !== undefined ? { logoutPending: o.logoutPending } : {}),
            ...(o.killed !== undefined ? { killed: o.killed } : {}),
          },
        })
      }
    })
  }

  async delete(vaultId: string): Promise<void> {
    await this.store.write(['vaults', 'cache', ...KEPT_STORES], tx => deleteVaultIn(tx, vaultId))
  }

  /**
   * Delete the vault if it has nothing pending. A vault still holding a discarded entry (kept sealed 30 days, §2.9)
   * or one held after a membership ended is kept. Returns whether it was deleted.
   */
  async deleteIfIdle(vaultId: string): Promise<boolean> {
    return this.store.write(['vaults', 'cache', ...KEPT_STORES], async tx => {
      const r = await recountPending(tx, vaultId)
      if (!r || hasPendingWork(r)) return false
      if ((await tx.all('outbox', vaultRange(vaultId))).some(o => o.state === 'discarded' || o.state === 'held_membership')) return false
      await deleteVaultIn(tx, vaultId)
      return true
    })
  }
}

async function deleteVaultIn(tx: Tx, vaultId: string): Promise<void> {
  for (const s of ['cache', 'outbox', 'audit', 'media', 'receipts'] as const) await tx.delete(s, vaultRange(vaultId))
  await tx.delete('vaults', vaultId)
}
