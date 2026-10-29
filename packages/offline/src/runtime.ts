/**
 * createOfflineRuntime: the real OfflineCore, wiring the store, vaults,
 * clock, lease, cache, outbox, audit, media, connectivity, broadcast and
 * storage health together (docs/OFFLINE-CONTRACT.md §2.3–§2.11, amendment A5).
 *
 * Sign-in (A5): when the mode is not `off`, `prepareFromSignIn` derives the
 * KEK in memory while the server sign-in runs, writing nothing. Once the
 * session is ready the app asks `offer(session)` and then calls
 * `attachSession`, which opens or creates the vault only for an enabled
 * facility and a person who accepted (or already has a vault here); otherwise
 * it drops the KEK and writes nothing.
 */

import {
  LIMITS,
  OFFLINE_PATHS,
  type CachedResult,
  type ClockState,
  type Connectivity,
  type GrantState,
  type LockReason,
  type OfflinePolicy,
  type PatientIndexEntry,
  type ResponseMeta,
  type StaffSessionSnapshot,
  type SyncSummary,
  type UnlockResult,
  type VaultStatus,
  type WipeReason,
} from './contracts'
import { AuditQueue } from './audit'
import { OfflineBroadcast, type OfflineMessage } from './broadcast'
import { ReadCache } from './cache'
import { TrustedClock } from './clock'
import { calibrateIterations, cryptoSupported, deriveKek, fromB64url, importEscrowKey, kekSalt, open as openSealed, randomBytes, randomUuid, recordAad, type VaultKeys } from './crypto'
import { leaseUntil, leaseVerdict, touchLease } from './lease'
import { MediaStore, type Reencoder } from './media'
import { ConnectivityMonitor } from './connectivity'
import { MAX_REASON, OutboxEngine, type LockManagerLike } from './outbox/engine'
import { evaluatePolicy, facilityAllowed, parseOfflineEnv, passwordLongEnough } from './policy'
import { StorageHealth } from './storageHealth'
import { OfflineStore, databaseExists, defaultFactory, vaultRange, type MetaRecord, type VaultRecord } from './store'
import type {
  MediaUploader,
  OfflineCore,
  OfflineEnv,
  OfflineOffer,
  OfflineReport,
  OfflineTransport,
  PatientEntryInput,
  SafetyProbe,
  StagedMedia,
} from './types'
import { VaultLimitError, Vaults, hasPendingWork, isReadable, sweepExpired, type OpenVault } from './vault'

export interface OfflineRuntimeOptions {
  /** `ehr` or `ocr` (the Migrate host). */
  readonly appHost: string
  /** The app's VITE_HID_OFFLINE_* values. */
  readonly env: OfflineEnv
  /** The staff transport (see transportFromApiClient in http.ts). */
  readonly transport: OfflineTransport
  readonly upload?: MediaUploader
  readonly safety?: SafetyProbe
  readonly report?: (e: OfflineReport) => void
  // Injected for tests and unusual runtimes; browser defaults otherwise.
  /** The IndexedDB factory (tests pass fake-indexeddb's). */
  readonly idbFactory?: IDBFactory
  readonly locks?: LockManagerLike | null
  readonly BroadcastChannel?: (new (name: string) => BroadcastChannel) | null
  readonly storage?: Pick<StorageManager, 'estimate'> & Partial<Pick<StorageManager, 'persist' | 'persisted'>> | null
  readonly wall?: () => number
  readonly mono?: () => number
  readonly random?: () => number
  readonly calibrate?: () => Promise<number>
  readonly reencode?: Reencoder | null
  readonly saveData?: () => boolean
  /** Start the probe, idle and storage timers. Default true; tests pass false and drive `tick()`. */
  readonly timers?: boolean
  /** How long a read waits for the network before showing the saved copy. Default 4 s (§2.7). */
  readonly networkFirstMs?: number
}

interface Prepared {
  email: string
  passwordOk: boolean
  kek: Promise<{ kek: CryptoKey; meta: MetaRecord; fresh: boolean } | null>
}

interface Unlocked {
  open: OpenVault
  kek: CryptoKey | null
  /** Session the vault serves (header, or the attached session after a wipe). */
  session: StaffSessionSnapshot
  /** Kill switch or facility removed: send what is pending, read nothing, then delete. */
  sendOnly: boolean
}

const TICK_MS = 15_000
const WALL_NOTE_MS = 60_000
const LEASE_WRITE_MS = 60_000

function defaultLocks(): LockManagerLike | null {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator
  return nav?.locks ?? null
}

function defaultStorage(): OfflineRuntimeOptions['storage'] {
  const nav = (globalThis as { navigator?: { storage?: StorageManager } }).navigator
  return nav?.storage ?? null
}

export interface OfflineRuntimeHandle extends OfflineCore {
  /** Run the periodic checks now (idle, lease, clock, grant sweep). Timers call it every 15 s. */
  tick(): Promise<void>
  /** Resolves when start-up work (the kill switch, if any) has finished. */
  ready(): Promise<void>
  /** Diagnostics and tests: the store, opened on demand. */
  storeForDiagnostics(): Promise<OfflineStore | null>
  /** Tests: wait until the sender is idle. */
  settle(): Promise<void>
}

export function createOfflineRuntime(o: OfflineRuntimeOptions): OfflineRuntimeHandle {
  const config = parseOfflineEnv(o.env)
  const appHost = o.appHost.toLowerCase()
  const factory = o.idbFactory ?? defaultFactory()
  const supported = cryptoSupported() && factory !== undefined
  const wall = o.wall ?? (() => Date.now())
  const mono = o.mono ?? (() => globalThis.performance.now())
  const random = o.random ?? Math.random
  const clock = new TrustedClock({ wall, mono })
  const broadcast = new OfflineBroadcast(o.BroadcastChannel === undefined ? globalThis.BroadcastChannel : o.BroadcastChannel)
  const listeners = new Set<() => void>()

  let storePromise: Promise<OfflineStore> | null = null
  let prepared: Prepared | null = null
  let unlocked: Unlocked | null = null
  let status: VaultStatus = 'none'
  let lastVaultId: string | null = null
  let attachedSession: StaffSessionSnapshot | null = null
  let sessionReady = false
  let policy: OfflinePolicy = evaluatePolicy(config, { appHost, supported })
  let lastActivity = mono()
  let hiddenSince: number | null = null
  let lastWallNote = 0
  let lastLeaseWrite = 0
  let lastSyncAt: number | null = null
  let disposed = false
  let summaryCache: SyncSummary = baseSummary()
  let refreshing: Promise<void> | null = null
  let refreshAgain = false
  const timers: ReturnType<typeof setInterval>[] = []

  function baseSummary(): SyncSummary {
    return {
      connectivity: 'online', vault: 'none', leaseUntil: null, clock: clock.state(),
      pending: 0, sending: 0, attention: 0, lastSyncAt: null, escrow: false,
      storage: { usageBytes: null, quotaBytes: null, persisted: null, low: false },
    }
  }

  async function dbExists(): Promise<boolean> {
    if (storePromise) return true
    return databaseExists(factory)
  }

  function store(): Promise<OfflineStore> {
    storePromise ??= OfflineStore.open(factory)
    return storePromise
  }

  async function storeIfExists(): Promise<OfflineStore | null> {
    if (!(await dbExists())) return null
    try { return await store() } catch { return null }
  }

  let vaultsCache: Vaults | null = null
  async function vaults(): Promise<Vaults> {
    vaultsCache ??= new Vaults(await store(), { appHost, now: () => clock.now(), ...(o.calibrate ? { calibrate: o.calibrate } : {}) })
    return vaultsCache
  }

  const notify = () => { for (const l of [...listeners]) l() }
  /** Patch the cheap fields at once (so `summary()` is right synchronously), then recount in the background. */
  const changed = () => {
    const next = {
      ...summaryCache, vault: status, connectivity: connectivity.current(), clock: clock.state(),
      leaseUntil: unlocked ? new Date(unlocked.open.record.lease.leaseUntil).toISOString() : null,
    }
    if (next.vault !== summaryCache.vault || next.connectivity !== summaryCache.connectivity || next.clock !== summaryCache.clock
      || next.leaseUntil !== summaryCache.leaseUntil) {
      summaryCache = next
      notify()
    }
    void refreshSummary()
  }

  function canRead(): boolean {
    return unlocked !== null && !unlocked.sendOnly && status === 'unlocked'
  }

  function gateOpen(): boolean {
    if (!canRead() || !unlocked) return false
    const lease = unlocked.open.record.lease
    return leaseVerdict(lease.leaseUntil, clock.now(), clock.state()) === 'ok'
  }

  const storageHealth = new StorageHealth(o.storage === undefined ? defaultStorage() : o.storage, changed)

  const connectivity = new ConnectivityMonitor({
    transport: o.transport,
    mono,
    onServerTime: iso => { if (!clock.anchored()) clock.observe(iso) },
    onChange: (next, prev) => {
      if (prev === 'offline' && next !== 'offline') {
        engine.syncNow()
        void audit.flush()
      }
      changed()
    },
  })

  // The stores are opened lazily; every collaborator reaches them through these hosts.
  let openStore: OfflineStore | null = null
  const lazyStore = new Proxy({} as OfflineStore, {
    get(_t, prop) {
      if (!openStore) throw new Error('Offline store is not open')
      const value = (openStore as unknown as Record<string | symbol, unknown>)[prop]
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(openStore) : value
    },
  })

  const cacheVault = () => (canRead() && unlocked ? { vaultId: unlocked.open.record.vaultId, keys: unlocked.open.keys } : null)
  const queueVault = () => (unlocked && status === 'unlocked' ? { vaultId: unlocked.open.record.vaultId, keys: unlocked.open.keys } : null)

  const cache = new ReadCache({
    store: lazyStore,
    vault: cacheVault,
    gateOpen,
    now: () => clock.now(),
    changed: () => { notify() },
    ...(o.networkFirstMs !== undefined ? { networkFirstMs: o.networkFirstMs } : {}),
  })

  const audit = new AuditQueue({
    store: lazyStore,
    transport: o.transport,
    vault: () => {
      const v = queueVault()
      return v && unlocked ? { ...v, facilityId: unlocked.session.facilityId } : null
    },
    canSend: () => sendAllowed(),
    now: () => clock.now(),
    clock: () => clock.state(),
    grantExpiresAt: async patientId => (await cache.grant(patientId).catch(() => null))?.expiresAt ?? null,
    changed,
    ...(o.report ? { report: o.report } : {}),
  })

  const media = new MediaStore({
    store: lazyStore,
    vault: queueVault,
    now: () => clock.now(),
    storageLow: () => storageHealth.current().low,
    acceptsNew: () => unlocked !== null && !unlocked.sendOnly,
    ...(o.reencode !== undefined ? { reencode: o.reencode } : {}),
  })

  function sendAllowed(): boolean {
    return unlocked !== null && status === 'unlocked' && sessionReady && connectivity.current() !== 'offline'
  }

  const engine = new OutboxEngine({
    store: lazyStore,
    transport: o.transport,
    ...(o.upload ? { upload: o.upload } : {}),
    ...(o.safety ? { safety: o.safety } : {}),
    ...(o.report ? { report: o.report } : {}),
    locks: o.locks === undefined ? defaultLocks() : o.locks,
    vault: () => {
      const v = queueVault()
      if (!v || !unlocked) return null
      const s = unlocked.session
      return { ...v, scope: { accountId: s.accountId, membershipId: s.membershipId, facilityId: s.facilityId } }
    },
    canSend: sendAllowed,
    acceptsNew: () => unlocked !== null && !unlocked.sendOnly,
    offline: () => connectivity.current() === 'offline',
    now: () => clock.now(),
    serverNow: () => clock.serverNow(),
    clock: () => clock.state(),
    random,
    saveData: o.saveData ?? (() => Boolean((globalThis as { navigator?: { connection?: { saveData?: boolean } } }).navigator?.connection?.saveData)),
    serverContact: () => { lastSyncAt = clock.now(); void touchServerContact() },
    sessionLost: () => { changed() },
    changed: () => {
      changed()
      void finishSendOnly()
    },
    broadcast: vaultId => broadcast.post({ type: 'outbox-changed', vaultId }),
    audit: e => audit.record({
      action: 'ehr.offline.command.discarded', patientId: e.patientId, section: null,
      details: { op: e.op, reason: e.reason.slice(0, MAX_REASON), bodySha256: e.bodySha256, capturedAt: e.capturedAt },
    }),
    idle: () => audit.flush(),
    readMedia: m => media.read(m.blobId, m.mediaType, m.sha256Hex),
  })

  async function refreshSummary(): Promise<void> {
    if (refreshing) { refreshAgain = true; return refreshing }
    refreshing = (async () => {
      try {
        const counts = openStore ? await engine.counts().catch(() => null) : null
        const u = unlocked
        const auditPending = u && openStore
          ? (await (await vaults()).get(u.open.record.vaultId).catch(() => undefined))?.pending.audit ?? 0 : 0
        const st = storageHealth.current()
        summaryCache = {
          connectivity: connectivity.current(),
          vault: status,
          leaseUntil: unlocked ? new Date(unlocked.open.record.lease.leaseUntil).toISOString() : null,
          clock: clock.state(),
          pending: (counts?.pending ?? 0) + auditPending,
          sending: counts?.sending ?? 0,
          attention: counts?.attention ?? 0,
          lastSyncAt: lastSyncAt === null ? null : new Date(lastSyncAt).toISOString(),
          escrow: unlocked?.open.record.flags.escrow ?? false,
          storage: { usageBytes: st.usageBytes, quotaBytes: st.quotaBytes, persisted: st.persisted, low: st.low },
        }
        notify()
      } finally {
        refreshing = null
        if (refreshAgain) { refreshAgain = false; void refreshSummary() }
      }
    })()
    return refreshing
  }

  async function touchServerContact(): Promise<void> {
    if (!unlocked) return
    const record = unlocked.open.record
    const lease = touchLease(record.lease, clock.now())
    unlocked.open = { ...unlocked.open, record: { ...record, lease } }
    if (mono() - lastLeaseWrite < LEASE_WRITE_MS) return
    lastLeaseWrite = mono()
    await persistLease()
  }

  async function persistLease(): Promise<void> {
    if (!unlocked) return
    const u = unlocked
    const snap = clock.snapshot()
    const lease = { ...u.open.record.lease, serverOffsetMs: snap.offsetMs, lastWallSeen: clock.noteWall() }
    try {
      const record = await (await vaults()).update(u.open.record.vaultId, r => ({ ...r, lease }))
      if (unlocked === u) unlocked.open = { ...u.open, record }
    } catch { /* the vault was deleted meanwhile */ }
  }

  function setPolicy(p: OfflinePolicy) {
    policy = p
  }

  async function openVault(open: OpenVault, kek: CryptoKey | null, session: StaffSessionSnapshot, sendOnly: boolean): Promise<void> {
    openStore = await store()
    unlocked = { open, kek, session, sendOnly }
    lastVaultId = open.record.vaultId
    status = 'unlocked'
    lastActivity = mono()
    clock.restore({ offsetMs: open.record.lease.serverOffsetMs, lastWallSeen: open.record.lease.lastWallSeen })
    engine.start()
    await engine.resumeSession()
    engine.syncNow()
    if (!sendOnly) {
      await cache.sweep().catch(() => undefined)
      void storageHealth.persist()
    }
    const referenced = new Set((await engine.snapshot()).map(i => i.cmd.input).flatMap(input => {
      const m = (input as { media?: { blobId?: unknown } } | null)?.media
      return typeof m?.blobId === 'string' ? [m.blobId] : []
    }))
    await media.sweepOrphans(referenced).catch(() => undefined)
    changed()
  }

  function dropKeys(next: VaultStatus) {
    engine.stop()
    unlocked = null
    status = next
    changed()
  }

  /** After the kill switch: once a send-only vault has nothing left, delete it. */
  async function finishSendOnly(): Promise<void> {
    const u = unlocked
    if (!u || !u.sendOnly || !openStore) return
    const deleted = await (await vaults()).deleteIfIdle(u.open.record.vaultId).catch(() => false)
    if (deleted && unlocked === u) {
      dropKeys('none')
    }
  }

  async function fetchEscrow(vaultId: string, facilityId: string): Promise<{ key: CryptoKey; keyVersion: number } | null> {
    try {
      const res = await o.transport({
        method: 'POST', path: OFFLINE_PATHS.escrow, body: { vaultId, keyVersion: null },
        headers: { 'X-Facility-ID': facilityId, 'X-Purpose-Of-Use': 'direct-care' },
      })
      const b = res.body as { keyVersion?: unknown; key?: unknown } | null
      if (!b || typeof b.key !== 'string' || typeof b.keyVersion !== 'number') return null
      const raw = fromB64url(b.key)
      const key = await importEscrowKey(raw)
      raw.fill(0)
      return { key, keyVersion: b.keyVersion }
    } catch {
      return null // 503 OFFLINE_ESCROW_UNAVAILABLE until escrow is switched on (A6).
    }
  }

  /**
   * The vault this KEK opens for this account and facility. A vault whose
   * header was wiped (sign-out, failed unlocks) no longer has a readable header;
   * it is matched by its QK-sealed binding (or, for a vault without one, by the
   * facility its first queued command names), and never reused for another
   * facility: its queued work and audit events belong to the facility it was
   * made for.
   */
  async function matchFor(opened: OpenVault[], s: StaffSessionSnapshot): Promise<OpenVault | null> {
    const same = (f: string | null | undefined) => f != null && f.toLowerCase() === s.facilityId.toLowerCase()
    for (const v of opened) {
      if (v.header && v.header.accountId === s.accountId && same(v.header.facilityId)) return v
    }
    for (const v of opened) {
      if (v.header) continue
      if (v.binding && v.binding.accountId !== s.accountId) continue
      if (same(v.binding?.facilityId ?? await headerlessFacility(v))) return v
    }
    return null
  }

  async function headerlessFacility(v: OpenVault): Promise<string | null> {
    const recs = await (await store()).read(['outbox'], tx => tx.all('outbox', vaultRange(v.record.vaultId)))
    const first = recs[0]
    if (!first) return null
    const cmd = await openSealed<{ scope?: { facilityId?: string } }>(v.keys.qk, recordAad(v.record.vaultId, 'outbox', [v.record.vaultId, first.seq]), first.value)
    return cmd.scope?.facilityId ?? null
  }

  function deriveFor(email: string, password: string): Prepared['kek'] {
    return (async () => {
      const exists = await dbExists()
      let meta: MetaRecord | undefined
      if (exists) meta = await (await store()).read(['meta'], tx => tx.get('meta', 'device'))
      let fresh = false
      if (!meta) {
        // Nothing is written yet: the device record is kept in memory until a vault is created.
        fresh = true
        meta = {
          id: 'device', v: 1, deviceId: randomUuid(), deviceSalt: randomBytes(16),
          kdf: { alg: 'PBKDF2-SHA256', iterations: await (o.calibrate ?? calibrateIterations)(), calibratedAt: new Date(wall()).toISOString() },
          failedUnlocks: 0, lastFailureAt: null,
        }
      }
      const kek = await deriveKek(password, await kekSalt(meta.deviceSalt, email), meta.kdf.iterations)
      return { kek, meta, fresh }
    })().catch(() => null)
  }

  /** Store the device record unless another tab stored one first; returns the record that is stored. */
  async function ensureMeta(meta: MetaRecord): Promise<MetaRecord> {
    const s = await store()
    return s.write(['meta'], async tx => {
      const current = await tx.get('meta', 'device')
      if (current) return current
      await tx.put('meta', meta)
      return meta
    })
  }

  function sameDevice(a: MetaRecord, b: MetaRecord): boolean {
    return a.kdf.iterations === b.kdf.iterations && a.deviceSalt.length === b.deviceSalt.length
      && a.deviceSalt.every((x, i) => x === b.deviceSalt[i])
  }

  /** Key-free expiry of 30-day holds and of wiped vaults left with nothing to send (D9). Trusted time only. */
  /** `spare`: the vault this sign-in matched, never treated as abandoned (A9.2). */
  async function sweep(spare: string | null = null): Promise<void> {
    // Server time only: a device clock moved forward must never bring a 30-day deletion closer (D9).
    const serverNow = clock.serverNow()
    if (serverNow === null) return
    const s = await storeIfExists()
    if (!s) return
    await sweepExpired(s, appHost, serverNow, spare).catch(() => undefined)
  }

  async function recordAuditUnlock(): Promise<void> {
    await audit.record({ action: 'ehr.offline.unlock', patientId: null, section: null }).catch(() => undefined)
  }

  async function wipeAudit(reason: WipeReason): Promise<void> {
    if (!unlocked) return
    await audit.record({ action: 'ehr.offline.wipe', patientId: null, section: reason }).catch(() => undefined)
  }

  /**
   * A reserved attempt opened nothing: it stays counted. At the limit every readable copy is wiped, and the counter
   * stays at the limit so later attempts are refused before any key is derived, until an online sign-in.
   */
  async function failedUnlock(): Promise<UnlockResult> {
    if ((await (await vaults()).failures()) >= LIMITS.maxFailedUnlocks) {
      await runtime.wipe('failed-unlocks')
      return { ok: false, reason: 'wiped' }
    }
    return { ok: false, reason: 'wrong-credentials' }
  }

  /** Reserve an attempt (D2); at the limit, wipe and refuse without deriving. */
  async function reserveAttempt(vs: Vaults): Promise<UnlockResult | null> {
    if (await vs.beginAttempt()) return null
    await runtime.wipe('failed-unlocks')
    return { ok: false, reason: 'wiped' }
  }

  async function unlockWith(email: string, password: string, onlyVaultId: string | null): Promise<UnlockResult> {
    if (config.mode === 'off' || !supported) return { ok: false, reason: 'no-vault' }
    const s = await storeIfExists()
    if (!s) return { ok: false, reason: 'no-vault' }
    openStore = s
    const vs = await vaults()
    const candidates = (await vs.list()).filter(r => onlyVaultId === null || r.vaultId === onlyVaultId)
    if (candidates.length === 0) return { ok: false, reason: 'no-vault' }
    const readableBefore = new Set(candidates.filter(isReadable).map(r => r.vaultId))
    const refused = await reserveAttempt(vs)
    if (refused) return refused
    let kek: CryptoKey
    try {
      kek = await vs.deriveKek(email, password)
    } catch {
      await vs.releaseAttempt(false)
      return { ok: false, reason: 'no-vault' }
    }
    const all = await vs.openWith(kek)
    const opened = all.filter(v => onlyVaultId === null || v.record.vaultId === onlyVaultId)
    if (opened.length === 0) return failedUnlock()
    const usable = opened.filter(v => v.header !== null && !v.record.flags.killed && !v.record.flags.logoutPending)
      .sort((a, b) => b.record.lease.lastServerContactAt - a.record.lease.lastServerContactAt)
    const stillReadable = await vs.releaseAttempt(all.length === (await vs.list()).length, { ids: opened.map(v => v.record.vaultId), readableBefore })
    const pick = stillReadable ? usable[0] : undefined
    if (!pick || !pick.header) return { ok: false, reason: 'wiped' }
    const allowed = facilityAllowed(config, appHost, pick.header.facilityId)
    if (allowed) return { ok: false, reason: 'no-vault' }
    clock.restore({ offsetMs: pick.record.lease.serverOffsetMs, lastWallSeen: pick.record.lease.lastWallSeen })
    const verdict = leaseVerdict(pick.record.lease.leaseUntil, clock.now(), clock.state())
    if (verdict === 'clock-suspect') return { ok: false, reason: 'clock-suspect' }
    if (verdict === 'lease-expired') {
      await vs.wipeCache([pick.record.vaultId])
      return { ok: false, reason: 'lease-expired' }
    }
    await openVault(pick, kek, pick.header, false)
    setPolicy({ mode: config.mode, enabled: true })
    await recordAuditUnlock()
    await refreshSummary()
    return { ok: true, summary: summaryCache }
  }

  /** Drop the keys in this tab; with `tell`, in every tab (BroadcastChannel). Forms stay mounted under the app's lock overlay. */
  function lockLocal(reason: LockReason, tell: boolean): void {
    if (status !== 'unlocked' || !unlocked || unlocked.sendOnly) return
    void persistLease()
    dropKeys('locked')
    if (tell) broadcast.post({ type: 'lock', reason })
  }

  async function onMessage(m: OfflineMessage): Promise<void> {
    switch (m.type) {
      case 'lock':
        if (status === 'unlocked') lockLocal(m.reason as LockReason, false)
        break
      case 'outbox-changed':
        if (unlocked && unlocked.open.record.vaultId === m.vaultId) engine.external()
        changed()
        break
      case 'wipe': {
        const u = unlocked
        if (u) {
          const record = await (await vaults()).get(u.open.record.vaultId).catch(() => undefined)
          if (unlocked === u) {
            if (!record) dropKeys('none')
            else if (!record.header && !u.sendOnly) dropKeys('locked')
          }
        }
        changed()
        break
      }
      default:
        break
    }
  }
  broadcast.on(m => { void onMessage(m) })
  broadcast.answerUpdateSafe(() => outboxSending())

  /**
   * A7: this origin's outbox has a command in state `sending` (or one on the wire from this tab). Read from the
   * plaintext state field, so a locked tab answers too.
   */
  async function outboxSending(): Promise<boolean> {
    if (engine.inFlight() > 0) return true
    if (!openStore) return false
    const recs = await openStore.read(['outbox'], tx => tx.all('outbox'))
    return recs.some(r => r.state === 'sending')
  }

  // Kill switch (§2.3): a release with mode `off` wipes every readable copy on the next load; pending work is kept
  // and sent after the next sign-in (attachSession opens those vaults send-only).
  const startup = (async () => {
    if (config.mode !== 'off' || !(await dbExists())) return
    try {
      openStore = await store()
      const vs = await vaults()
      const all = await vs.list()
      if (all.length > 0) await vs.wipeCache(all.map(v => v.vaultId), { killed: true })
      for (const v of all) if (!hasPendingWork(v)) await vs.delete(v.vaultId)
      o.report?.({ kind: 'wipe', reason: 'kill-switch' })
    } catch { /* storage unavailable: nothing readable to wipe */ }
  })()

  const runtime: OfflineRuntimeHandle = {
    policy: () => policy,

    prepareFromSignIn(email, password) {
      prepared = null
      if (!supported) return
      const passwordOk = passwordLongEnough(password)
      if (config.mode === 'off' || !config.hosts.has(appHost)) {
        // Kill switch (§2.3): derive only to drain vaults that still hold unsent work; a device without the
        // database derives nothing.
        prepared = { email: email.trim().toLowerCase(), passwordOk, kek: dbExists().then(exists => (exists ? deriveFor(email, password) : null)) }
        return
      }
      // Derivation runs while the server sign-in runs. The password is referenced only by this closure until it ends.
      prepared = { email: email.trim().toLowerCase(), passwordOk, kek: deriveFor(email, password) }
    },

    async offer(s): Promise<OfflineOffer> {
      await startup
      const reason = !supported ? 'unsupported-browser' as const : facilityAllowed(config, appHost, s.facilityId)
      if (reason) return { kind: 'unavailable', reason }
      if (!prepared) return (await runtime.hasVaults()) ? { kind: 'paused' } : { kind: 'unavailable', reason: 'not-opted-in' }
      const derived = await prepared.kek
      if (derived && !derived.fresh) {
        const vs = await vaults()
        if (await matchFor(await vs.openWith(derived.kek), s)) return { kind: 'existing' }
      }
      if (!prepared.passwordOk) return { kind: 'unavailable', reason: 'password-too-short' }
      if (derived && !derived.fresh) {
        await sweep()
        const all = await (await vaults()).list()
        if (all.length >= LIMITS.maxVaultsPerOrigin && all.every(hasPendingWork)) return { kind: 'unavailable', reason: 'device-full' }
      }
      if (!derived) return { kind: 'unavailable', reason: 'unsupported-browser' }
      return { kind: 'ask' }
    },

    async attachSession(s, opts) {
      await startup
      attachedSession = s
      const p = prepared
      prepared = null
      const reason = !supported ? 'unsupported-browser' as const : facilityAllowed(config, appHost, s.facilityId)
      if (!p) {
        // Online reload: no password in this tab. Vaults stay sealed until the person unlocks.
        if (reason) setPolicy(evaluatePolicy(config, { appHost, facilityId: s.facilityId, supported }))
        else setPolicy(evaluatePolicy(config, { appHost, facilityId: s.facilityId, optedIn: null, supported }))
        status = (await runtime.hasVaults()) ? 'locked' : 'none'
        await refreshSummary()
        return summaryCache
      }
      const derived = await p.kek
      if (!derived) {
        setPolicy({ mode: config.mode, enabled: false, reason: 'unsupported-browser' })
        await refreshSummary()
        return summaryCache
      }
      const { kek, meta, fresh } = derived
      const vs = fresh ? null : await vaults()
      let opened = vs ? await vs.openWith(kek) : []
      let match = await matchFor(opened, s)
      if (vs) {
        // After matching, so this sign-in's own vault is spared; anything the sweep deleted is dropped from the lists.
        await sweep(match?.record.vaultId ?? null)
        const left = new Set((await vs.list()).map(r => r.vaultId))
        opened = opened.filter(v => left.has(v.record.vaultId))
        if (match && !left.has(match.record.vaultId)) match = null
      }

      if (reason) {
        // Not enabled for this facility (or the kill switch): never read or fill; send what is pending, then delete.
        setPolicy({ mode: config.mode, enabled: false, reason })
        if (match && vs) {
          await vs.wipeCache([match.record.vaultId], { killed: true })
          if (hasPendingWork(match.record)) {
            const reopened = await vs.unwrap(kek, (await vs.get(match.record.vaultId))!)
            await openVault(reopened, null, s, true)
          } else {
            await vs.delete(match.record.vaultId)
          }
        }
        await refreshSummary()
        return summaryCache
      }

      // A vault made while escrow could not be reached may stand in for an older one escrow can still recover.
      const placeholder = match && match.record.flags.escrowRetry && !hasPendingWork(match.record) ? match : null
      let escrowAsked = false
      if (vs && (!match || placeholder)) {
        // Password changed online: a vault with unsent work that the new key cannot open is recovered through escrow
        // (§2.5, A8.9). The escrow key is bound to the facility, so only this facility's vault opens; at most 5 calls.
        const openedIds = new Set(opened.map(v => v.record.vaultId))
        const candidates = (await vs.list()).filter(r => r.wraps.qkEsc && hasPendingWork(r) && !openedIds.has(r.vaultId))
        escrowAsked = candidates.length === 0
        for (const record of candidates) {
          const escrow = await fetchEscrow(record.vaultId, s.facilityId)
          if (!escrow) continue
          escrowAsked = true
          const recovered = await vs.rewrapAfterPasswordChange(kek, record, escrow.key, s)
          if (recovered) {
            if (placeholder && !(await vs.deleteIfIdle(placeholder.record.vaultId))) {
              // Kept for a discarded or held entry (§2.9, D9): its readable copy goes now, so signing out of the
              // recovered vault leaves nothing readable, and it no longer stands in for anything.
              await vs.wipeCache([placeholder.record.vaultId])
              await vs.update(placeholder.record.vaultId, r => ({ ...r, flags: { ...r.flags, escrowRetry: false } }))
            }
            match = recovered
            break
          }
        }
      }

      if (!match && opts.optIn && p.passwordOk) {
        if (fresh && !sameDevice(await ensureMeta(meta), meta)) {
          // Another tab stored the device record first: this KEK used a salt that is not stored and could never open
          // a vault again. Drop it; the next sign-in derives with the stored salt.
          setPolicy({ mode: config.mode, enabled: false, reason: 'not-opted-in' })
          status = (await runtime.hasVaults()) ? 'locked' : 'none'
          await refreshSummary()
          return summaryCache
        }
        const v = await vaults()
        const vaultId = randomUuid()
        const escrow = await fetchEscrow(vaultId, s.facilityId)
        try {
          match = await v.createWithId(kek, vaultId, s, escrow ?? undefined)
          if (!escrow) match = { ...match, record: await v.update(vaultId, r => ({ ...r, flags: { ...r.flags, escrowRetry: true } })) }
        } catch (error) {
          // Five vaults all with unsent work: no room for another (A8, `device-full`).
          setPolicy({ mode: config.mode, enabled: false, reason: error instanceof VaultLimitError ? 'device-full' : 'not-opted-in' })
          await refreshSummary()
          return summaryCache
        }
      }

      if (!match) {
        // Declined, or not opted in: the KEK is dropped and nothing is written.
        setPolicy(evaluatePolicy(config, { appHost, facilityId: s.facilityId, optedIn: false, passwordOk: p.passwordOk, supported }))
        status = opened.length > 0 || (await runtime.hasVaults()) ? 'locked' : 'none'
        await refreshSummary()
        return summaryCache
      }

      const v = await vaults()
      const now = clock.now()
      const lease = { ...match.record.lease, signedInAt: now, lastServerContactAt: now, leaseUntil: leaseUntil(now, now) }
      match = await v.writeHeader(match, s, lease)
      if (!match.record.wraps.qkEsc) {
        const escrow = await fetchEscrow(match.record.vaultId, s.facilityId)
        if (escrow) match = await v.addEscrow(kek, match, escrow)
      }
      // A placeholder keeps asking at later sign-ins until the recovery itself ran with escrow answering (it is skipped
      // while the placeholder holds unsent work), not merely until its own wrap was added.
      if (match.record.flags.escrowRetry && escrowAsked && match.record.wraps.qkEsc) {
        match = { ...match, record: await v.update(match.record.vaultId, r => ({ ...r, flags: { ...r.flags, escrowRetry: false } })) }
      }
      await v.clearFailures()
      await openVault(match, kek, s, false)
      setPolicy({ mode: config.mode, enabled: true })
      await persistLease()
      await refreshSummary()
      return summaryCache
    },

    unlockOffline: (email, password) => unlockWith(email, password, null),

    async unlockLocked(password) {
      const email = unlocked?.session.email ?? attachedSession?.email ?? null
      if (!email) return { ok: false, reason: 'no-vault' }
      if (attachedSession && !unlocked) {
        // Online reload: open the vault for the attached session's facility.
        const s = await storeIfExists()
        if (!s) return { ok: false, reason: 'no-vault' }
        openStore = s
        const vs = await vaults()
        const readableBefore = new Set((await vs.list()).filter(isReadable).map(r => r.vaultId))
        const refused = await reserveAttempt(vs)
        if (refused) return refused
        let kek: CryptoKey
        try { kek = await vs.deriveKek(email, password) } catch { await vs.releaseAttempt(false); return { ok: false, reason: 'no-vault' } }
        const opened = await vs.openWith(kek)
        if (opened.length === 0) return failedUnlock()
        await vs.releaseAttempt(opened.length === (await vs.list()).length, { ids: opened.map(v => v.record.vaultId), readableBefore })
        let match = await matchFor(opened, attachedSession)
        if (!match) return { ok: false, reason: 'no-vault' }
        if (facilityAllowed(config, appHost, attachedSession.facilityId)) return { ok: false, reason: 'no-vault' }
        if (match.record.flags.membershipEndedAt !== null) {
          // The attached session is a server-verified session at this facility: the membership is current (A9.2).
          match = { ...match, record: await vs.update(match.record.vaultId, r => ({ ...r, flags: { ...r.flags, membershipEndedAt: null } })) }
        }
        await openVault(match, kek, attachedSession, false)
        setPolicy({ mode: config.mode, enabled: true })
        await recordAuditUnlock()
        await refreshSummary()
        return { ok: true, summary: summaryCache }
      }
      return unlockWith(email, password, lastVaultId)
    },

    restoreSession: () => (unlocked && !unlocked.sendOnly && status === 'unlocked' ? unlocked.open.header ?? null : null),

    lock: reason => lockLocal(reason, true),

    async signOut(opts) {
      const id = unlocked?.open.record.vaultId ?? lastVaultId
      engine.stop()
      unlocked = null
      const s = id ? openStore : await storeIfExists()
      if (s) {
        openStore = s
        const vs = await vaults()
        // Without a key this tab cannot tell which vault is this person's (an online reload never unlocked), so
        // every readable copy on this app host is wiped: a sign-out must never leave a chart readable offline.
        const ids = id ? [id] : (await vs.list()).map(v => v.vaultId)
        await vs.wipeCache(ids, { logoutPending: !opts.online })
        if (opts.online) for (const v of ids) await vs.deleteIfIdle(v)
        broadcast.post({ type: 'wipe', reason: 'sign-out' })
      }
      attachedSession = null
      prepared = null
      status = (await runtime.hasVaults()) ? 'locked' : 'none'
      await refreshSummary()
    },

    async wipe(reason) {
      const s = await storeIfExists()
      if (!s) return
      openStore = s
      const vs = await vaults()
      await wipeAudit(reason)
      const current = unlocked?.open.record.vaultId ?? lastVaultId
      const all = (await vs.list()).map(v => v.vaultId)
      switch (reason) {
        case 'failed-unlocks':
        case 'kill-switch':
          await vs.wipeCache(all, reason === 'kill-switch' ? { killed: true } : {})
          if (unlocked) dropKeys(reason === 'kill-switch' ? 'none' : 'locked')
          break
        case 'membership':
          // CC8 (D9): unsent work stays sealed 30 days, then is deleted.
          if (unlocked) await engine.holdMembership()
          // The end time is recorded on the vault (also when locked, when the queue cannot be resealed as held) so
          // the sweep removes it 30 days later; a later sign-in at this facility clears it (writeHeader).
          if (current) await vs.wipeCache([current], { membershipEndedAt: clock.serverNow() ?? clock.now() })
          if (unlocked) dropKeys('locked')
          break
        case 'lease':
          if (current) await vs.wipeCache([current])
          if (unlocked) dropKeys('expired')
          else status = 'expired'
          break
        default:
          if (current) await vs.wipeCache([current])
          if (unlocked) dropKeys('locked')
      }
      o.report?.({ kind: 'wipe', reason })
      broadcast.post({ type: 'wipe', reason })
      await refreshSummary()
    },

    async hasVaults() {
      const s = await storeIfExists()
      if (!s) return false
      openStore = s
      return (await (await vaults()).list()).length > 0
    },

    trustedNow: () => ({ at: new Date(clock.now()), clock: clock.state() as ClockState }),
    summary: () => summaryCache,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    onResponseMeta(meta: ResponseMeta) {
      if (meta.authenticated && meta.status !== null && meta.date) clock.observe(meta.date)
      connectivity.observe(meta)
      if (meta.authenticated && meta.status !== null && meta.status >= 200 && meta.status < 300) {
        lastSyncAt = clock.now()
        void touchServerContact()
      }
    },

    setSessionReady(ready) {
      sessionReady = ready
      if (ready) {
        void engine.resumeSession()
        engine.syncNow()
      }
      changed()
    },

    noteActivity() { lastActivity = mono() },
    noteVisibility(hidden) { hiddenSince = hidden ? mono() : null },
    connectivity: (): Connectivity => connectivity.current(),

    async updateSafe() {
      if (await outboxSending()) return false
      return broadcast.othersSafe()
    },

    async rememberPatient(e: PatientEntryInput) {
      if (!canRead()) return
      await cache.remember(e)
    },

    async stageMedia(file: Blob, opts: { index: number }): Promise<StagedMedia> {
      return media.stage(file, opts)
    },

    async logoutPending() {
      const s = await storeIfExists()
      if (!s) return false
      openStore = s
      return (await (await vaults()).list()).some(v => v.flags.logoutPending)
    },

    async logoutSent() {
      const s = await storeIfExists()
      if (!s) return
      openStore = s
      const vs = await vaults()
      for (const v of (await vs.list()).filter(r => r.flags.logoutPending)) {
        await vs.update(v.vaultId, r => ({ ...r, flags: { ...r.flags, logoutPending: false } }))
        await vs.deleteIfIdle(v.vaultId)
      }
    },

    async tick() {
      if (disposed) return
      const u = unlocked
      if (u && status === 'unlocked' && !u.sendOnly) {
        // Grant expiry first: trusted time never runs behind, so this holds even when the clock is suspect.
        await cache.sweep().catch(() => undefined)
        const idleFor = mono() - lastActivity
        if (idleFor >= LIMITS.idleLockMs) { runtime.lock('idle'); return }
        if (hiddenSince !== null && mono() - hiddenSince >= LIMITS.idleLockMs) { runtime.lock('hidden'); return }
        if (clock.state() === 'suspect') { runtime.lock('clock'); return }
        if (clock.now() >= u.open.record.lease.leaseUntil) {
          await runtime.wipe('lease')
          broadcast.post({ type: 'lock', reason: 'lease' })
          return
        }
        if (mono() - lastWallNote >= WALL_NOTE_MS) {
          lastWallNote = mono()
          clock.noteWall()
          await persistLease()
        }
      }
      changed()
    },

    ready: () => startup,

    async storeForDiagnostics() {
      return storeIfExists()
    },

    async settle() {
      await engine.settle()
      await refreshSummary()
    },

    dispose() {
      disposed = true
      for (const t of timers) clearInterval(t)
      connectivity.stop()
      storageHealth.stop()
      engine.dispose()
      broadcast.close()
      listeners.clear()
    },

    reads: {
      read<T>(spec: { method: string; args: readonly unknown[]; patientId: string; network: () => Promise<T>; emergency?: boolean }): Promise<CachedResult<T>> {
        return cache.read(spec)
      },
      async setGrant(g: GrantState) {
        await cache.setGrant(g)
        if (g.writeAllowed && !g.breakGlass) await engine.accessRestored(g.patientId)
      },
      dropPatient: patientId => cache.dropPatient(patientId),
      keepOffline: (patientId, fetchers) => cache.keepOffline(patientId, fetchers),
    },

    commands: {
      register: defs => engine.register(defs),
      save: (op, input, opts) => engine.save(op, input, opts),
      edit: (id, input) => engine.edit(id, input),
      cancel: id => engine.cancel(id),
      pendingFor: (patientId, visit) => engine.pendingFor(patientId, visit),
      syncNow: () => engine.syncNow(),
    },

    review: {
      list: () => engine.list(),
      resolve: (id, action, opts) => engine.resolve(id, action, opts),
    },

    audit: {
      recordOpen: (patientId, section, resourceId) => audit.recordOpen(patientId, section, resourceId),
    },

    patients: {
      async list(): Promise<PatientIndexEntry[]> {
        if (!canRead() || !gateOpen()) return []
        const entries = await cache.index()
        const out: PatientIndexEntry[] = []
        for (const e of entries) {
          if (!(await cache.readable(e.patientId))) continue
          out.push({ ...e, pendingCount: (await engine.pendingFor(e.patientId)).length })
        }
        return out
      },
      async search(q: string) {
        const needle = q.trim().toLowerCase()
        if (!needle) return runtime.patients.list()
        return (await runtime.patients.list()).filter(e => e.displayName.toLowerCase().includes(needle) || e.hidCode.toLowerCase() === needle
          || e.hidCode.toLowerCase().includes(needle))
      },
    },
  }

  if (o.timers !== false) {
    connectivity.start()
    timers.push(setInterval(() => { void runtime.tick() }, TICK_MS))
    if (supported) storageHealth.start()
  }

  return runtime
}

export type { VaultKeys, VaultRecord }
