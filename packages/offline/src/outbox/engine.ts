/**
 * The outbox engine (§2.8, §2.9).
 *
 * Invariants it keeps:
 *  I1  `save` resolves only after the IndexedDB commit of the queued record.
 *  I2  At most once: one key per command for its life (`off1.<uuid>`), the
 *      frozen request replayed byte for byte, the receipt check before any
 *      refusal of a command that may already have been applied.
 *  I3  Never overwrite: an edit or cancel succeeds only while never sent, in
 *      one transaction that the sender's freeze also checks.
 *  I4  FIFO per lane (lanes.ts).
 *  I5  Pending is never truth: pending commands are an overlay, never cached.
 *
 * One sender per vault, chosen by the Web Lock
 * `health-id-offline:send:<vaultId>`; other tabs only add commands and listen.
 */

import {
  LIMITS,
  type CommandOutcome,
  type CommandQueue,
  type ConflictClass,
  type Json,
  type OpDefinition,
  type OpName,
  type PendingView,
  type Receipt,
  type Ref,
  type ReviewQueue,
} from '../contracts'
import { hmacTag, open, randomUuid, recordAad, seal, sha256Hex, type VaultKeys } from '../crypto'
import { lookupReceipts } from '../receipts'
import { vaultRange, type OfflineStore, type OutboxRecord, type ReceiptRecord, type Tx } from '../store'
import {
  SaveRefused,
  TransportError,
  isTransportError,
  type MediaUploader,
  type OfflineReport,
  type OfflineTransport,
  type SafetyProbe,
  type SendResult,
} from '../types'
import { recountPending } from '../vault'
import { STILL_TRYING_MS, backoffMs } from './backoff'
import { classify, isDefinitiveFirstRefusal, needsReceiptCheck, type FailureClass } from './classify'
import { isUnfinished, type Command, type LastProblem } from './command'
import { TooLongError, freeze, newCommandKey, resolveRefs, sizeAtSave, type ResolvedRef } from './freeze'
import { MEDIA_LANE, blockedBehind, eligible, laneFor, visitLane } from './lanes'

export interface OpenVaultRef {
  vaultId: string
  keys: VaultKeys
  scope: { accountId: string; membershipId: string; facilityId: string }
}

export interface LockManagerLike {
  request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>
}

export interface EngineHost {
  readonly store: OfflineStore
  readonly transport: OfflineTransport
  readonly upload?: MediaUploader
  readonly safety?: SafetyProbe
  readonly report?: (event: OfflineReport) => void
  readonly locks?: LockManagerLike | null
  /** The unlocked vault, or null. */
  vault(): OpenVaultRef | null
  /** Session ready, connectivity not offline, vault unlocked. */
  canSend(): boolean
  /** Connectivity is offline right now (for "saved offline"). */
  offline(): boolean
  /** Trusted time, ms. */
  now(): number
  clock(): 'anchored' | 'wall' | 'suspect'
  random(): number
  saveData(): boolean
  /** A 2xx came back: move the lease forward. */
  serverContact(): void
  /** The session failed (401 or MFA): the app asks for a sign-in. */
  sessionLost(): void
  /** Something a summary or a list shows changed. */
  changed(): void
  /** Tell other tabs the outbox changed. */
  broadcast(vaultId: string): void
  /** Record a discard in the offline audit trail. */
  audit(event: { patientId: string; op: OpName; reason: string; bodySha256: string; capturedAt: string }): Promise<void>
  /** Audit and other low-priority work, run when clinical lanes are idle. */
  idle?(): Promise<void>
  /** Read a staged media blob back (decrypted, hash checked). */
  readMedia?(media: { blobId: string; mediaType: string; sha256Hex: string }): Promise<Blob>
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

interface Item { seq: number; rec: OutboxRecord; cmd: Command }

const APPLIED_KEEP_MS = 60_000
const SEND_TIMEOUT_MS = 15_000
const ALLOWED_ACTIONS: Record<ConflictClass, readonly string[]> = {
  CC1: [], CC2: ['apply-on-top', 'discard'], CC3: ['new-visit', 'edit-as-new', 'discard'], CC4: ['send-as-is', 'discard'],
  CC5: ['ask-access', 'discard'], CC6: [], CC7: ['edit-as-new', 'discard'], CC8: [],
}
const CLASS_FOR: Partial<Record<FailureClass, ConflictClass>> = {
  access: 'CC5', edge: 'CC7', invalid: 'CC7', missing: 'CC3', state: 'CC3', version: 'CC2',
}

function outboxAad(vaultId: string, seq: number): string {
  return recordAad(vaultId, 'outbox', [vaultId, seq])
}

function receiptAad(vaultId: string, commandId: string): string {
  return recordAad(vaultId, 'receipts', [vaultId, commandId])
}

export function lockName(vaultId: string): string {
  return `health-id-offline:send:${vaultId}`
}

function stateLabel(cmd: Command, now: number): string {
  switch (cmd.state) {
    case 'queued': return 'Saved on this device, not sent yet'
    case 'sending':
      if (cmd.review?.class === 'CC1') return "Sent, waiting for confirmation. Don't enter it again."
      if (cmd.firstAttemptAt !== undefined && now - cmd.firstAttemptAt >= STILL_TRYING_MS) return 'Still trying'
      return 'Saved on this device, sending'
    case 'held_access': return 'Waiting for access to this patient'
    case 'held_session': return 'Waiting for you to sign in'
    case 'held_membership': return 'Cannot be sent from this account'
    case 'review': return 'Needs your review'
    default: return ''
  }
}

export class OutboxEngine implements CommandQueue, ReviewQueue {
  private readonly defs = new Map<OpName, OpDefinition<Json>>()
  private items: Item[] = []
  private receipts = new Map<string, Receipt>()
  private loadedFor: string | null = null
  private sender = false
  private releaseLock: (() => void) | null = null
  private lockAbort: AbortController | null = null
  private pumping = false
  private again = false
  private sessionHeld = false
  private readonly inflight = new Map<string, Promise<void>>()
  private timer: unknown = null
  private readonly waiters = new Set<() => void>()
  private disposed = false
  private receiptsPrunedAt = 0

  constructor(private readonly host: EngineHost) {}

  // --- lifecycle -----------------------------------------------------------------

  /** Become the sender for the open vault when this tab wins its Web Lock. */
  start(): void {
    const v = this.host.vault()
    if (!v || this.lockAbort) return
    this.sessionHeld = false
    const locks = this.host.locks
    if (!locks) {
      // No Web Locks (an old browser): send from this tab. Keys and receipts still keep it at most once.
      this.sender = true
      this.kick()
      return
    }
    const abort = new AbortController()
    this.lockAbort = abort
    locks.request(lockName(v.vaultId), { signal: abort.signal }, async () => {
      if (abort.signal.aborted) return
      this.sender = true
      this.kick()
      await new Promise<void>(resolve => { this.releaseLock = resolve })
      this.sender = false
    }).catch(() => undefined)
  }

  /** Stop sending (lock, sign-out, dispose). In-flight requests finish; nothing new starts. */
  stop(): void {
    this.lockAbort?.abort()
    this.lockAbort = null
    this.releaseLock?.()
    this.releaseLock = null
    this.sender = false
    if (this.timer !== null) (this.host.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = null
    this.loadedFor = null
    this.items = []
    this.receipts.clear()
    this.wake()
  }

  dispose(): void {
    this.disposed = true
    this.stop()
  }

  isSender(): boolean {
    return this.sender
  }

  /** Requests on the wire from this tab right now (for the shell's update-safe query). */
  inFlight(): number {
    return this.inflight.size
  }

  /** The session is back (sign-in or unlock): held_session commands become sendable again. */
  async resumeSession(): Promise<void> {
    this.sessionHeld = false
    const v = this.host.vault()
    if (!v) return
    await this.load(true)
    for (const it of this.items.filter(i => i.cmd.state === 'held_session')) {
      await this.persist(v, it, { ...it.cmd, state: it.cmd.everSent ? 'sending' : 'queued', nextAttemptAt: 0, review: undefined })
    }
    this.kick()
  }

  /** Another tab changed the outbox. */
  external(): void {
    this.loadedFor = null
    this.wake()
    this.kick()
  }

  register(defs: readonly OpDefinition<any>[]): void { // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const d of defs) this.defs.set(d.op, d as OpDefinition<Json>)
  }

  // --- loading and persisting ----------------------------------------------------------

  private async load(force = false): Promise<void> {
    const v = this.host.vault()
    if (!v) { this.items = []; this.receipts.clear(); this.loadedFor = null; return }
    if (!force && this.loadedFor === v.vaultId) return
    const { outbox, receipts } = await this.host.store.read(['outbox', 'receipts'], async tx => ({
      outbox: await tx.all('outbox', vaultRange(v.vaultId)),
      receipts: await tx.all('receipts', vaultRange(v.vaultId)),
    }))
    const items: Item[] = []
    for (const rec of outbox) {
      if (rec.v !== 1) continue
      const cmd = await open<Command>(v.keys.qk, outboxAad(v.vaultId, rec.seq), rec.value)
      // The plaintext scheduling field is authoritative (syncNow resets it without resealing).
      cmd.nextAttemptAt = rec.nextAttemptAt
      items.push({ seq: rec.seq, rec, cmd })
    }
    const map = new Map<string, Receipt>()
    for (const r of receipts) {
      if (r.v !== 1) continue
      map.set(r.commandId, await open<Receipt>(v.keys.qk, receiptAad(v.vaultId, r.commandId), r.value))
    }
    this.items = items.sort((a, b) => a.seq - b.seq)
    this.receipts = map
    this.loadedFor = v.vaultId
  }

  private async plaintext(v: OpenVaultRef, seq: number, cmd: Command, expiresAt: number | null): Promise<OutboxRecord> {
    return {
      v: 1, vaultId: v.vaultId, seq, laneTag: await hmacTag(v.keys.ik, cmd.lane), state: cmd.state, priority: cmd.priority,
      attempts: cmd.attempts, nextAttemptAt: cmd.nextAttemptAt,
      dependsOn: cmd.dependsOn.map(id => this.items.find(i => i.cmd.id === id)?.seq).filter((n): n is number => n !== undefined),
      everSent: cmd.everSent, updatedAt: Math.max(this.host.now(), (this.items.find(i => i.seq === seq)?.rec?.updatedAt ?? 0) + 1), bytes: cmd.frozen?.bytes ?? 0, expiresAt,
      value: await seal(v.keys.qk, 'qk', outboxAad(v.vaultId, seq), cmd),
    }
  }

  private static expiryFor(cmd: Command, now: number): number | null {
    if (cmd.state === 'applied') return now + APPLIED_KEEP_MS
    if (cmd.state === 'discarded') return now + LIMITS.discardedKeepMs
    if (cmd.state === 'held_membership') return now + LIMITS.membershipEndedKeepMs
    return null
  }

  /**
   * Write a command in one transaction. `guard` sees the stored record first
   * and may refuse (returns false), e.g. when another tab changed it since it
   * was loaded. Extra writes ride in the same transaction.
   */
  private async persist(
    v: OpenVaultRef, item: Item, cmd: Command,
    o: { guard?: (current: OutboxRecord | undefined) => boolean; extra?: (tx: Tx) => Promise<void>; receipt?: ReceiptRecord } = {},
  ): Promise<boolean> {
    const rec = await this.plaintext(v, item.seq, cmd, OutboxEngine.expiryFor(cmd, this.host.now()))
    const ok = await this.host.store.write(['vaults', 'outbox', 'audit', 'media', 'receipts'], async tx => {
      const current = await tx.get('outbox', [v.vaultId, item.seq])
      if (o.guard && !o.guard(current)) return false
      await tx.put('outbox', rec)
      if (o.receipt) await tx.put('receipts', o.receipt)
      await o.extra?.(tx)
      await recountPending(tx, v.vaultId)
      return true
    })
    if (ok) {
      item.rec = rec
      item.cmd = cmd
      if (cmd.receipt && cmd.state === 'applied') this.receipts.set(cmd.id, cmd.receipt)
      this.host.broadcast(v.vaultId)
      this.host.changed()
      this.wake()
    }
    return ok
  }

  private lookupRef = (commandId: string): ResolvedRef | null => {
    const r = this.receipts.get(commandId)
    return r ? { id: r.resourceId, ...(r.rowVersion !== undefined ? { rowVersion: r.rowVersion } : {}) } : null
  }

  // --- save, edit, cancel ------------------------------------------------------

  async save<V>(op: OpName, input: Json, o: { awaitMs?: number; dependsOn?: string[]; supersedes?: string } = {}): Promise<CommandOutcome<V>> {
    const v = this.host.vault()
    if (!v) throw new SaveRefused('unavailable')
    const def = this.defs.get(op)
    if (!def) throw new Error(`The offline operation ${op} is not registered.`)
    const bytes = sizeAtSave(def, input)
    if (bytes > LIMITS.maxBodyBytes) throw new SaveRefused('too-long', { bytes })

    const id = randomUuid()
    const { patientId, lane, priority } = laneFor(def, input, id)
    const refs = def.refs(input)
    const local = Object.values(refs).flatMap(r => ('local' in r ? [r.local] : []))
    const offline = this.host.offline()
    const safety = def.safety === 'prescription' ? await this.host.safety?.capture(input).catch(() => null) ?? undefined : undefined
    const cmd: Command = {
      v: 1, id, key: newCommandKey(randomUuid()), op, opVersion: 1,
      scope: { ...v.scope, patientId, purpose: 'direct-care' },
      input, refs, dependsOn: [...new Set([...(o.dependsOn ?? []), ...local])], lane, priority,
      capturedAt: new Date(this.host.now()).toISOString(), clock: this.host.clock(), savedOffline: offline,
      ...(def.intent ? { intent: def.intent(input) } : {}),
      ...(safety ? { safety } : {}),
      ...(o.supersedes ? { supersedes: o.supersedes } : {}),
      state: 'queued', everSent: false, attempts: 0, nextAttemptAt: 0,
    }

    // Reserve a sequence number, seal with it (the AAD names it), then write the record in its own transaction.
    const seq = await this.host.store.write(['vaults'], async tx => {
      const r = await tx.get('vaults', v.vaultId)
      if (!r) throw new SaveRefused('unavailable')
      const next = r.counters.cmdSeq + 1
      await tx.put('vaults', { ...r, counters: { ...r.counters, cmdSeq: next } })
      return next
    })
    await this.load()
    const item: Item = { seq, rec: undefined as unknown as OutboxRecord, cmd }
    this.items.push(item)
    await this.persist(v, item, cmd, { guard: current => current === undefined })
    // I1: from here the command is saved on this device.

    const awaitMs = o.awaitMs ?? LIMITS.receiptWaitMs
    if (awaitMs <= 0 || !this.host.canSend()) {
      this.kick()
      return { kind: 'saved', commandId: id }
    }
    this.kick()
    return this.awaitOutcome<V>(v, id, awaitMs)
  }

  private wake(): void {
    for (const w of [...this.waiters]) w()
  }

  private async awaitOutcome<V>(v: OpenVaultRef, id: string, ms: number): Promise<CommandOutcome<V>> {
    const deadline = Date.now() + ms
    for (;;) {
      await this.load(!this.sender)
      const item = this.items.find(i => i.cmd.id === id)
      if (!item) return { kind: 'saved', commandId: id }
      const c = item.cmd
      if (c.state === 'applied' && c.receipt) return { kind: 'applied', value: c.value as V, receipt: c.receipt }
      if (c.lastProblem?.firstRefusal && c.attempts === 1) {
        // Nothing was applied: remove the command and hand the error to the form.
        const removed = await this.host.store.write(['vaults', 'outbox', 'audit', 'media', 'receipts'], async tx => {
          const current = await tx.get('outbox', [v.vaultId, item.seq])
          if (!current || current.attempts !== 1 || current.state === 'applied') return false
          await tx.delete('outbox', [v.vaultId, item.seq])
          await recountPending(tx, v.vaultId)
          return true
        })
        if (removed) {
          this.items = this.items.filter(i => i !== item)
          this.host.broadcast(v.vaultId)
          this.host.changed()
          const p = c.lastProblem
          throw new SaveRefused('refused', { cause: new TransportError({ status: p.status, code: p.code ?? null, problem: p.problem, body: p.body }) })
        }
      }
      const left = deadline - Date.now()
      if (left <= 0 || this.disposed) return { kind: 'saved', commandId: id }
      await new Promise<void>(resolve => {
        const done = () => { this.waiters.delete(done); clearTimeout(t); resolve() }
        const t = setTimeout(done, Math.min(left, 250))
        this.waiters.add(done)
      })
    }
  }

  private async neverSentChange(commandId: string, change: (item: Item) => Command | null, remove = false): Promise<void> {
    const v = this.host.vault()
    if (!v) throw new SaveRefused('unavailable')
    await this.load(true)
    const item = this.items.find(i => i.cmd.id === commandId)
    if (!item || item.cmd.everSent || !isUnfinished(item.cmd.state)) {
      throw new Error('This entry has already been sent. Save a change as a new entry.')
    }
    const loadedAt = item.rec.updatedAt
    const guard = (current: OutboxRecord | undefined) => current !== undefined && !current.everSent && current.updatedAt === loadedAt
    if (remove) {
      const ok = await this.host.store.write(['vaults', 'outbox', 'audit', 'media', 'receipts'], async tx => {
        const current = await tx.get('outbox', [v.vaultId, item.seq])
        if (!guard(current)) return false
        await tx.delete('outbox', [v.vaultId, item.seq])
        const blobId = mediaBlobOf(item.cmd.input)
        if (blobId) await tx.delete('media', vaultRange(v.vaultId, blobId))
        await recountPending(tx, v.vaultId)
        return true
      })
      if (!ok) throw new Error('This entry has already been sent. Save a change as a new entry.')
      this.items = this.items.filter(i => i !== item)
      this.host.broadcast(v.vaultId)
      this.host.changed()
      return
    }
    const next = change(item)
    if (!next) return
    if (!(await this.persist(v, item, next, { guard }))) throw new Error('This entry has already been sent. Save a change as a new entry.')
    this.kick()
  }

  async edit(commandId: string, input: Json): Promise<void> {
    let safety: Command['safety'] | undefined
    const item0 = this.items.find(i => i.cmd.id === commandId)
    const def0 = item0 ? this.defs.get(item0.cmd.op) : undefined
    if (def0?.safety === 'prescription') safety = await this.host.safety?.capture(input).catch(() => null) ?? undefined
    await this.neverSentChange(commandId, item => {
      const def = this.defs.get(item.cmd.op)
      if (!def) throw new Error(`The offline operation ${item.cmd.op} is not registered.`)
      const bytes = sizeAtSave(def, input)
      if (bytes > LIMITS.maxBodyBytes) throw new SaveRefused('too-long', { bytes })
      const refs = def.refs(input)
      const { lane } = laneFor(def, input, item.cmd.id)
      const fromSafety = item.cmd.review?.class === 'CC4'
      return {
        ...item.cmd, input, refs, lane, frozen: undefined,
        ...(def.intent ? { intent: def.intent(input) } : {}),
        ...(safety ? { safety } : {}),
        ...(fromSafety ? { state: 'queued' as const, review: undefined, savedOffline: this.host.offline() } : {}),
      }
    })
  }

  async cancel(commandId: string): Promise<void> {
    await this.neverSentChange(commandId, () => null, true)
  }

  async pendingFor(patientId: string, visit?: Ref): Promise<PendingView[]> {
    if (!this.host.vault()) return []
    await this.load(!this.sender)
    const lane = visit ? visitLane(patientId, visit) : null
    const now = this.host.now()
    return this.items
      .filter(i => isUnfinished(i.cmd.state) && i.cmd.scope.patientId === patientId && (lane === null || i.cmd.lane === lane))
      .map(i => ({ commandId: i.cmd.id, op: i.cmd.op, state: i.cmd.state, capturedAt: i.cmd.capturedAt, label: stateLabel(i.cmd, now), input: i.cmd.input }))
  }

  syncNow(): void {
    // Connectivity came back, a sign-in, or the person asked: forget the transient backoff of everything waiting.
    void this.resetBackoff().catch(() => undefined).finally(() => this.kick())
  }

  private async resetBackoff(): Promise<void> {
    const v = this.host.vault()
    if (!v) return
    const busy = new Set([...this.inflight.keys()])
    const busySeqs = new Set(this.items.filter(i => busy.has(i.cmd.lane)).map(i => i.seq))
    await this.host.store.write(['outbox'], async tx => {
      for (const r of await tx.all('outbox', vaultRange(v.vaultId))) {
        // Only the plaintext scheduling field changes; `updatedAt` stays, so no guard is disturbed.
        if ((r.state === 'queued' || r.state === 'sending') && r.nextAttemptAt > 0 && !busySeqs.has(r.seq)) {
          await tx.put('outbox', { ...r, nextAttemptAt: 0 })
        }
      }
    })
    this.loadedFor = null
  }

  /** Counts for the sync summary. */
  async counts(): Promise<{ pending: number; sending: number; attention: number; oldestFirstAttempt: number | null }> {
    if (!this.host.vault()) return { pending: 0, sending: 0, attention: 0, oldestFirstAttempt: null }
    await this.load(!this.sender)
    const open = this.items.filter(i => isUnfinished(i.cmd.state))
    return {
      pending: open.length,
      sending: open.filter(i => i.cmd.state === 'sending').length,
      attention: open.filter(i => ['review', 'held_access', 'held_membership', 'held_session'].includes(i.cmd.state) || i.cmd.review?.class === 'CC1').length,
      oldestFirstAttempt: open.reduce<number | null>((m, i) => (i.cmd.firstAttemptAt === undefined ? m : m === null ? i.cmd.firstAttemptAt : Math.min(m, i.cmd.firstAttemptAt)), null),
    }
  }

  // --- review ------------------------------------------------------------------

  async list(): Promise<{ commandId: string; class: ConflictClass; laneBlocked: number; patientId: string; op: OpName }[]> {
    if (!this.host.vault()) return []
    await this.load(!this.sender)
    return this.items
      .filter(i => i.cmd.review && isUnfinished(i.cmd.state))
      .map(i => ({
        commandId: i.cmd.id, class: i.cmd.review!.class, patientId: i.cmd.scope.patientId, op: i.cmd.op,
        laneBlocked: blockedBehind(this.items, i.seq, i.cmd.lane),
      }))
  }

  async resolve(commandId: string, action: 'apply-on-top' | 'new-visit' | 'send-as-is' | 'edit-as-new' | 'ask-access' | 'discard',
    o: { reason?: string; input?: Json }): Promise<void> {
    const v = this.host.vault()
    if (!v) throw new SaveRefused('unavailable')
    await this.load(true)
    const item = this.items.find(i => i.cmd.id === commandId)
    if (!item || !item.cmd.review || !isUnfinished(item.cmd.state)) throw new Error('This entry no longer needs review.')
    const cls = item.cmd.review.class
    if (!ALLOWED_ACTIONS[cls].includes(action)) throw new Error('That action is not available for this entry.')
    const reason = (o.reason ?? '').trim()
    if (action !== 'send-as-is' && reason.length < 8) throw new Error('Give a reason of at least 8 characters.')
    const loadedAt = item.rec.updatedAt
    const guard = (current: OutboxRecord | undefined) => current !== undefined && current.updatedAt === loadedAt

    switch (action) {
      case 'send-as-is':
        // Never sent, so the same key and a fresh freeze are safe.
        await this.persist(v, item, { ...item.cmd, state: 'queued', review: undefined, safetyCleared: true }, { guard })
        break
      case 'ask-access':
        await this.persist(v, item, { ...item.cmd, awaitingAccess: true }, { guard })
        break
      case 'discard':
        await this.discard(v, item, reason, guard)
        break
      case 'apply-on-top':
      case 'new-visit':
      case 'edit-as-new': {
        if (o.input === undefined) throw new Error('A new entry needs its details.')
        await this.discard(v, item, reason, guard)
        await this.save(item.cmd.op, o.input, { awaitMs: 0, supersedes: item.cmd.id })
        break
      }
    }
    this.kick()
  }

  private async discard(v: OpenVaultRef, item: Item, reason: string, guard?: (c: OutboxRecord | undefined) => boolean): Promise<void> {
    const at = new Date(this.host.now()).toISOString()
    const bodySha256 = await sha256Hex(JSON.stringify(item.cmd.frozen?.body ?? item.cmd.input))
    const ok = await this.persist(v, item, { ...item.cmd, state: 'discarded', discarded: { reason, at } }, guard ? { guard } : {})
    if (!ok) throw new Error('This entry changed in another tab. Look again.')
    await this.host.audit({ patientId: item.cmd.scope.patientId, op: item.cmd.op, reason, bodySha256, capturedAt: item.cmd.capturedAt })
  }

  /** Consent now allows writing for this patient: CC5 commands the author asked about resume with the same key and body. */
  async accessRestored(patientId: string): Promise<void> {
    const v = this.host.vault()
    if (!v) return
    await this.load(true)
    for (const it of this.items.filter(i => i.cmd.state === 'held_access' && i.cmd.scope.patientId === patientId && i.cmd.awaitingAccess)) {
      await this.persist(v, it, { ...it.cmd, state: it.cmd.everSent ? 'sending' : 'queued', review: undefined, awaitingAccess: false, nextAttemptAt: 0 })
    }
    this.kick()
  }

  /** CC8: the session no longer lists the facility. Unsent work stays sealed for 30 days, then is deleted (D9). */
  async holdMembership(): Promise<void> {
    const v = this.host.vault()
    if (!v) return
    await this.load(true)
    const openedAt = new Date(this.host.now()).toISOString()
    for (const it of this.items.filter(i => isUnfinished(i.cmd.state) && i.cmd.state !== 'held_membership')) {
      await this.persist(v, it, { ...it.cmd, state: 'held_membership', review: { class: 'CC8', openedAt } })
    }
  }

  // --- sending -------------------------------------------------------------------

  /** Schedule a pump on the next task. `now` resets the timer. */
  private kick(_now = false): void {
    if (this.disposed) return
    queueMicrotask(() => { void this.pump() })
  }

  private schedule(at: number): void {
    const set = this.host.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
    const clear = this.host.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
    if (this.timer !== null) clear(this.timer)
    const delay = Math.max(0, at - this.host.now())
    this.timer = set(() => { this.timer = null; this.kick() }, Math.min(delay, 2_147_483_647))
  }

  private async prune(v: OpenVaultRef): Promise<void> {
    const now = this.host.now()
    const expired = this.items.filter(i => i.rec?.expiresAt != null && i.rec.expiresAt <= now)
    const receiptsDue = now - this.receiptsPrunedAt > 3600_000
    if (expired.length === 0 && !receiptsDue) return
    this.receiptsPrunedAt = now
    await this.host.store.write(['vaults', 'outbox', 'audit', 'media', 'receipts'], async tx => {
      for (const i of expired) {
        await tx.delete('outbox', [v.vaultId, i.seq])
        const blobId = mediaBlobOf(i.cmd.input)
        if (blobId && i.cmd.state !== 'applied') await tx.delete('media', vaultRange(v.vaultId, blobId))
      }
      for (const r of await tx.all('receipts', vaultRange(v.vaultId))) {
        if (r.appliedAt + LIMITS.receiptKeepMs <= now) await tx.delete('receipts', [v.vaultId, r.commandId])
      }
      if (expired.length > 0) await recountPending(tx, v.vaultId)
    })
    if (expired.length > 0) {
      this.items = this.items.filter(i => !expired.includes(i))
      this.host.changed()
    }
  }

  async pump(): Promise<void> {
    if (this.pumping) { this.again = true; return }
    this.pumping = true
    try {
      const v = this.host.vault()
      if (!v || !this.sender || this.sessionHeld || this.disposed) return
      await this.load(true)
      await this.prune(v)
      // A command whose dependency was discarded can never be sent as it is (CC3).
      for (const it of this.items.filter(i => isUnfinished(i.cmd.state) && !i.cmd.review)) {
        const dead = it.cmd.dependsOn.some(id => this.items.find(x => x.cmd.id === id)?.cmd.state === 'discarded')
        if (dead) await this.persist(v, it, { ...it.cmd, state: 'review', review: { class: 'CC3', openedAt: new Date(this.host.now()).toISOString() } })
      }
      if (!this.host.canSend()) return
      const now = this.host.now()
      const ready = eligible(this.items, { now, applied: new Set(this.receipts.keys()), busy: new Set(this.inflight.keys()) })
      const clinicalBusy = [...this.inflight.keys()].filter(l => l !== MEDIA_LANE).length
      let slots = LIMITS.clinicalLanes - clinicalBusy
      let startedClinical = false
      for (const it of ready.filter(i => i.cmd.priority < 2)) {
        if (slots <= 0) break
        slots -= 1
        startedClinical = true
        this.track(it)
      }
      if (!startedClinical && clinicalBusy === 0) {
        await this.host.idle?.().catch(() => undefined)
        const media = ready.find(i => i.cmd.priority === 2)
        if (media && !this.inflight.has(MEDIA_LANE) && !this.host.saveData()) this.track(media)
      }
      const next = this.items
        .filter(i => (i.cmd.state === 'queued' || i.cmd.state === 'sending') && i.cmd.nextAttemptAt > now)
        .reduce<number | null>((m, i) => (m === null ? i.cmd.nextAttemptAt : Math.min(m, i.cmd.nextAttemptAt)), null)
      if (next !== null) this.schedule(next)
    } finally {
      this.pumping = false
      if (this.again) {
        this.again = false
        this.kick()
      }
    }
  }

  private track(it: Item): void {
    const lane = it.cmd.lane
    const run = this.attempt(it)
      .catch((error: unknown) => {
        this.host.report?.({ kind: 'engine-error', op: it.cmd.op, message: error instanceof Error ? error.name : 'error' })
      })
      .finally(() => {
        this.inflight.delete(lane)
        this.kick()
      })
    this.inflight.set(lane, run)
  }

  /** Wait for everything in flight (tests, sign-out). */
  async settle(): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
      if (this.inflight.size === 0 && !this.pumping) {
        await new Promise(resolve => setTimeout(resolve, 0))
        if (this.inflight.size === 0 && !this.pumping) return
      }
      await Promise.allSettled([...this.inflight.values()])
    }
  }

  private problemFrom(error: unknown): { status: number | null; code: string | null; problem: boolean; networkError: boolean; retryAfterMs: number | null; body?: unknown } {
    if (isTransportError(error)) {
      return { status: error.status, code: error.code, problem: error.problem, networkError: error.networkError, retryAfterMs: error.retryAfterMs, body: error.body }
    }
    return { status: null, code: null, problem: false, networkError: true, retryAfterMs: null }
  }

  private async attempt(it: Item): Promise<void> {
    const v = this.host.vault()
    if (!v) return
    const def = this.defs.get(it.cmd.op)
    const now = () => this.host.now()
    const at = () => new Date(now()).toISOString()
    if (!def) {
      await this.persist(v, it, { ...it.cmd, state: 'review', review: { class: 'CC7', openedAt: at() } })
      return
    }
    let cmd: Command = { ...it.cmd }
    const loadedAt = it.rec.updatedAt

    if (!cmd.frozen) {
      // CC4 safety hold, before the first send of a prescription saved offline or from data older than 15 minutes.
      if (def.safety === 'prescription' && !cmd.safetyCleared) {
        const stale = cmd.savedOffline || !cmd.safety || now() - Date.parse(cmd.safety.seenAt) > 15 * 60_000
        if (stale) {
          let changed = true
          if (this.host.safety && cmd.safety) {
            const resolvedIds = resolveRefs(cmd.refs, this.lookupRef)?.ids ?? {}
            try {
              const current = await this.host.safety.current(cmd.input, resolvedIds)
              changed = current.allergiesSha256 !== cmd.safety.allergiesSha256 || current.encounterRxSha256 !== cmd.safety.encounterRxSha256
            } catch (error) {
              // Cannot check right now: try again later rather than send unchecked.
              const p = this.problemFrom(error)
              await this.persist(v, it, { ...cmd, nextAttemptAt: now() + backoffMs(cmd.attempts + 1, () => this.host.random(), p.retryAfterMs) },
                { guard: c => c?.updatedAt === loadedAt })
              return
            }
          }
          if (changed) {
            await this.persist(v, it, { ...cmd, state: 'review', review: { class: 'CC4', openedAt: at() } }, { guard: c => c?.updatedAt === loadedAt })
            return
          }
        }
      }
      const resolved = resolveRefs(cmd.refs, this.lookupRef)
      if (!resolved) return
      try {
        const frozen = freeze({
          def, input: cmd.input, key: cmd.key, facilityId: cmd.scope.facilityId, capturedAt: cmd.capturedAt, clock: cmd.clock,
          resolved, lookup: this.lookupRef, frozenAt: at(),
        })
        if (!frozen) return
        cmd.frozen = frozen
      } catch (error) {
        if (error instanceof TooLongError) {
          await this.persist(v, it, { ...cmd, state: 'review', review: { class: 'CC7', openedAt: at() },
            lastProblem: { status: 413, code: 'TOO_LONG', problem: false, at: at() } }, { guard: c => c?.updatedAt === loadedAt })
          return
        }
        throw error
      }
    }

    const sentBefore = cmd.everSent
    cmd = { ...cmd, everSent: true, attempts: cmd.attempts + 1, state: 'sending', firstAttemptAt: cmd.firstAttemptAt ?? now() }
    // Freeze, everSent and attempts in one transaction, checked against what was loaded (I3).
    if (!(await this.persist(v, it, cmd, { guard: c => c !== undefined && c.updatedAt === loadedAt && (c.state === 'queued' || c.state === 'sending') }))) return
    const sentAt = it.rec.updatedAt

    let result: SendResult | null = null
    let failure: ReturnType<OutboxEngine['problemFrom']> | null = null
    try {
      result = def.op === 'ehr.document.upload' ? await this.sendMedia(cmd) : await this.host.transport({
        method: cmd.frozen!.method, path: cmd.frozen!.path, body: cmd.frozen!.body, headers: cmd.frozen!.headers, timeoutMs: SEND_TIMEOUT_MS,
      })
    } catch (error) {
      failure = this.problemFrom(error)
    }
    const guard = (c: OutboxRecord | undefined) => c !== undefined && c.updatedAt === sentAt

    if (result) {
      await this.applied(v, it, cmd, def, result.status, result.body, 'response', guard)
      return
    }
    const f = failure!
    const answer = { status: f.status, code: f.code, problem: f.problem, networkError: f.networkError, path: cmd.frozen!.path }
    const cls = classify(answer)
    const lastProblem: LastProblem = { status: f.status, code: f.code, problem: f.problem, at: at() }

    if (cls === 'transient') {
      await this.persist(v, it, { ...cmd, state: 'sending', lastProblem,
        nextAttemptAt: now() + backoffMs(cmd.attempts, () => this.host.random(), f.retryAfterMs) }, { guard })
      return
    }
    if (cls === 'session') {
      this.sessionHeld = true
      await this.persist(v, it, { ...cmd, state: 'held_session', lastProblem }, { guard })
      this.host.sessionLost()
      return
    }
    if (!sentBefore && isDefinitiveFirstRefusal(answer)) {
      // Nothing was applied. A waiting `save` removes it and hands the error to the form; otherwise it is reviewed.
      lastProblem.firstRefusal = true
      lastProblem.body = f.body
    }
    if (needsReceiptCheck(cls, sentBefore)) {
      let found: Awaited<ReturnType<typeof lookupReceipts>> | null = null
      try {
        found = await lookupReceipts(this.host.transport, cmd.scope.facilityId, [cmd.key])
      } catch {
        // CC1: the lookup itself is unreachable. "Sent, waiting for confirmation. Don't enter it again."
        await this.persist(v, it, { ...cmd, state: 'sending', lastProblem, review: { class: 'CC1', openedAt: at() },
          nextAttemptAt: now() + backoffMs(cmd.attempts, () => this.host.random()) }, { guard })
        return
      }
      const r = found.get(cmd.key)
      if (r?.state === 'completed') {
        await this.applied(v, it, cmd, def, r.responseStatus, null, 'lookup', guard, { resourceType: r.resourceType, resourceId: r.resourceId })
        return
      }
      if (r?.state === 'processing') {
        await this.persist(v, it, { ...cmd, state: 'sending', lastProblem,
          nextAttemptAt: now() + backoffMs(cmd.attempts, () => this.host.random()) }, { guard })
        return
      }
      if (cls === 'applied-unreadable') {
        // The server says it completed but cannot show it, and the lookup does not know it: keep asking.
        await this.persist(v, it, { ...cmd, state: 'sending', lastProblem, review: { class: 'CC1', openedAt: at() },
          nextAttemptAt: now() + backoffMs(cmd.attempts, () => this.host.random()) }, { guard })
        return
      }
    }
    if (cls === 'applied-unreadable') {
      await this.applied(v, it, cmd, def, 200, null, 'lookup', guard)
      return
    }
    if (cls === 'version' && def.method === 'PATCH' && sentBefore && def.reread && cmd.intent) {
      // 412 on a PATCH sent before: if the record already shows our change, it was applied.
      try {
        const resolved = resolveRefs(cmd.refs, this.lookupRef)
        const current = resolved ? await def.reread(cmd.input, resolved.ids) : null
        if (current && typeof current === 'object' && Object.entries(cmd.intent).every(([k, val]) =>
          JSON.stringify((current as Record<string, unknown>)[k]) === JSON.stringify(val))) {
          await this.applied(v, it, cmd, def, 200, current, 'reread', guard)
          return
        }
      } catch {
        await this.persist(v, it, { ...cmd, state: 'sending', lastProblem,
          nextAttemptAt: now() + backoffMs(cmd.attempts, () => this.host.random()) }, { guard })
        return
      }
    }
    const conflict = CLASS_FOR[cls] ?? 'CC7'
    if (cls === 'edge' || cls === 'invalid') {
      // A defect: the body was checked at save, so report it (status and code only, never content).
      this.host.report?.({ kind: 'defect', op: cmd.op, status: f.status, code: f.code })
    }
    await this.persist(v, it, {
      ...cmd, state: conflict === 'CC5' ? 'held_access' : 'review', lastProblem, review: { class: conflict, openedAt: at() },
    }, { guard })
  }

  private async applied(
    v: OpenVaultRef, it: Item, cmd: Command, def: OpDefinition<Json>, status: number, body: unknown, via: Receipt['via'],
    guard: (c: OutboxRecord | undefined) => boolean, known?: { resourceType: string; resourceId: string },
  ): Promise<void> {
    let fromBody: { resourceType: string; resourceId: string; rowVersion?: number } | null = null
    if (body !== null && body !== undefined) {
      try { fromBody = def.receipt(body) } catch { fromBody = null }
    }
    const base = fromBody ?? known ?? { resourceType: 'unknown', resourceId: '' }
    const receipt: Receipt = {
      commandId: cmd.id, ...base, status, replay: via !== 'response', serverDate: new Date(this.host.now()).toISOString(), via,
    }
    const next: Command = { ...cmd, state: 'applied', receipt, value: body ?? null, review: undefined }
    const receiptRecord: ReceiptRecord = {
      v: 1, vaultId: v.vaultId, commandId: cmd.id, appliedAt: this.host.now(),
      value: await seal(v.keys.qk, 'qk', receiptAad(v.vaultId, cmd.id), receipt),
    }
    const blobId = mediaBlobOf(cmd.input)
    await this.persist(v, it, next, {
      guard, receipt: receiptRecord,
      // Media chunks go once the document is applied.
      ...(blobId ? { extra: (tx: Tx) => tx.delete('media', vaultRange(v.vaultId, blobId)) } : {}),
    })
    this.host.serverContact()
  }

  /** Composite upload: keyed intent → PUT to the presigned URL → complete (§2.8 registry, `ehr.document.upload`). */
  private async sendMedia(cmd: Command): Promise<SendResult> {
    const media = mediaOf(cmd.input)
    if (!this.host.upload || !this.host.readMedia || !media) throw new TransportError({ status: 400, code: 'MEDIA_UNAVAILABLE', problem: true })
    const frozen = cmd.frozen!
    // Replaying the intent with the same key returns the same document and a fresh URL.
    const intent = await this.host.transport({ method: frozen.method, path: frozen.path, body: frozen.body, headers: frozen.headers, timeoutMs: SEND_TIMEOUT_MS })
    const body = intent.body as { document?: { id?: string }; upload?: { url?: string; requiredHeaders?: Record<string, string> } }
    const documentId = body.document?.id
    const url = body.upload?.url
    if (!documentId || !url) throw new TransportError({ status: 502, code: 'INVALID_RESPONSE' })
    const blob = await this.host.readMedia(media)
    try {
      await this.host.upload({ url, body: blob, requiredHeaders: body.upload?.requiredHeaders ?? {} })
    } catch (error) {
      if (isTransportError(error)) throw error
      throw new TransportError({ status: null, networkError: true })
    }
    const done = await this.host.transport({
      method: 'POST', path: `/api/v1/ehr/documents/${encodeURIComponent(documentId)}/complete`,
      headers: { 'X-Facility-ID': frozen.headers['X-Facility-ID'] ?? cmd.scope.facilityId, 'X-Purpose-Of-Use': 'direct-care' },
      timeoutMs: SEND_TIMEOUT_MS,
    })
    return { status: done.status, body: intent.body, date: done.date }
  }

  /** For tests and diagnostics: every command in the open vault, decrypted. */
  async snapshot(): Promise<{ seq: number; cmd: Command }[]> {
    await this.load(true)
    return this.items.map(i => ({ seq: i.seq, cmd: i.cmd }))
  }
}

/** The staged media a document command carries in its input (`media`), if any. */
export function mediaOf(input: Json): { blobId: string; mediaType: string; sha256Hex: string } | null {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const m = (input as Record<string, Json>).media
    if (m && typeof m === 'object' && !Array.isArray(m) && typeof m.blobId === 'string'
      && typeof m.mediaType === 'string' && typeof m.sha256Hex === 'string') {
      return { blobId: m.blobId, mediaType: m.mediaType, sha256Hex: m.sha256Hex }
    }
  }
  return null
}

export function mediaBlobOf(input: Json): string | null {
  return mediaOf(input)?.blobId ?? null
}
